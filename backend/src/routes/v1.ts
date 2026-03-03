import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { config } from "../config.js";
import {
  getJobById,
  getJobInspectorTrace,
  getTranscriptSampleByJobId,
  listArtifacts,
  listRecentTranscriptSamples,
} from "../repositories/jobsRepo.js";
import { createTranscriptJob, getLiveJobInspectorTrace, getServiceLimits } from "../services/jobsService.js";
import { createEpubFromTranscriptInline } from "../services/epubInlineService.js";

const router = Router();

const outputFormatSchema = z.array(z.enum(["epub", "pdf", "md"])).min(1);
const complianceSchema = z.object({
  for_personal_or_authorized_use_only: z.literal(true),
  no_commercial_use: z.literal(true),
});

const transcriptRequestSchema = z.object({
  title: z.string().min(1).max(300),
  language: z.string().min(1),
  transcript_text: z.string().min(10).max(getServiceLimits().maxTranscriptChars),
  template_id: z.string().default("templateA-v0-book"),
  output_formats: outputFormatSchema,
  metadata: z.record(z.unknown()).optional(),
  compliance_declaration: complianceSchema,
});

const epubTranscriptRequestSchema = z.object({
  title: z.string().min(1).max(300),
  language: z.string().min(1),
  transcript_text: z.string().min(10).max(getServiceLimits().maxTranscriptChars),
  template_id: z.string().default("templateA-v0-book"),
  metadata: z.record(z.unknown()).optional(),
  compliance_declaration: complianceSchema,
});

function mapArtifactsResponse(items: Awaited<ReturnType<typeof listArtifacts>>) {
  return items.map((item) => ({
    type: item.type,
    file_name: item.fileName,
    size_bytes: item.sizeBytes,
    download_url: item.downloadUrl,
    expires_at: item.expiresAt,
  }));
}

function getUser(req: Request): { id: string; email: string } {
  const user = req.authUser;
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return user;
}

function requireDatabaseBackedJobs(endpoint: string) {
  if (!config.databaseEnabled) {
    throw new ApiError(503, "DB_REQUIRED", `DATABASE_URL is required for ${endpoint}. Use /v1/epub/from-transcript for DB-free inline runs.`);
  }
}

async function createTranscriptJobResponse(
  req: Request,
  res: Response,
  parsed: z.infer<typeof transcriptRequestSchema> | z.infer<typeof epubTranscriptRequestSchema>,
  outputFormats: z.infer<typeof outputFormatSchema>,
  runMode: "inline" | "background",
  includeInlineDetails = false,
) {
  const user = getUser(req);
  const job = await createTranscriptJob({
    userId: user.id,
    title: parsed.title,
    language: parsed.language,
    transcriptText: parsed.transcript_text,
    templateId: parsed.template_id,
    outputFormats,
    runMode,
    metadata: parsed.metadata,
    compliance: parsed.compliance_declaration,
  });

  const basePayload = {
    job_id: job.jobId,
    status: job.status,
    created_at: job.createdAt,
  };

  if (!includeInlineDetails || job.status !== "succeeded") {
    res.status(202).json(basePayload);
    return;
  }

  const [artifacts, stages] = await Promise.all([listArtifacts(job.jobId), getJobInspectorTrace(job.jobId)]);
  res.status(200).json({
    ...basePayload,
    artifacts: mapArtifactsResponse(artifacts),
    stages,
    traceability: {
      source_type: "transcript",
      source_ref: "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  });
}

const createTranscriptRoute = asyncHandler(async (req: Request, res) => {
  requireDatabaseBackedJobs("/v1/jobs/from-transcript");
  const parsed = transcriptRequestSchema.parse(req.body);
  await createTranscriptJobResponse(req, res, parsed, parsed.output_formats, "background");
});

const createEpubFromTranscriptRoute = asyncHandler(async (req: Request, res) => {
  const parsed = epubTranscriptRequestSchema.parse(req.body);
  const response = await createEpubFromTranscriptInline({
    title: parsed.title,
    language: parsed.language,
    transcriptText: parsed.transcript_text,
    templateId: parsed.template_id,
    metadata: parsed.metadata,
    compliance: parsed.compliance_declaration,
  });
  res.status(200).json(response);
});

router.post("/jobs/from-transcript", createTranscriptRoute);
router.post("/epub/from-transcript", createEpubFromTranscriptRoute);

router.get(
  "/jobs/:job_id",
  asyncHandler(async (req, res) => {
    requireDatabaseBackedJobs("/v1/jobs/:job_id");
    const user = getUser(req);
    const job = await getJobById(req.params.job_id, user.id);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "Job not found.");
    }
    res.status(200).json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      error: job.errorCode
        ? {
            code: job.errorCode,
            message: job.errorMessage ?? "Job failed.",
          }
        : null,
    });
  }),
);

router.get(
  "/jobs/:job_id/artifacts",
  asyncHandler(async (req, res) => {
    requireDatabaseBackedJobs("/v1/jobs/:job_id/artifacts");
    const user = getUser(req);
    const job = await getJobById(req.params.job_id, user.id);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "Job not found.");
    }
    if (job.status !== "succeeded") {
      throw new ApiError(409, "JOB_NOT_READY", "Artifacts are not ready.");
    }
    const artifacts = await listArtifacts(job.id);
    res.status(200).json({
      job_id: job.id,
      status: job.status,
      artifacts: mapArtifactsResponse(artifacts),
      traceability: {
        source_type: job.sourceType,
        source_ref: "internal://source-ref",
        generated_at: new Date().toISOString(),
      },
    });
  }),
);

router.get(
  "/jobs/:job_id/inspector",
  asyncHandler(async (req, res) => {
    requireDatabaseBackedJobs("/v1/jobs/:job_id/inspector");
    const user = getUser(req);
    const job = await getJobById(req.params.job_id, user.id);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "Job not found.");
    }
    const liveStages = getLiveJobInspectorTrace(job.id);
    const stages = liveStages ?? (await getJobInspectorTrace(job.id));
    res.status(200).json({
      job_id: job.id,
      stages,
      live: Boolean(liveStages && job.status === "processing"),
    });
  }),
);

router.get(
  "/dev/transcript-samples",
  asyncHandler(async (req, res) => {
    requireDatabaseBackedJobs("/v1/dev/transcript-samples");
    const user = getUser(req);
    const parsedLimit = Number(req.query.limit ?? 12);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(30, Math.floor(parsedLimit))) : 12;
    const samples = await listRecentTranscriptSamples(user.id, limit);
    res.status(200).json({
      samples: samples.map((sample) => ({
        job_id: sample.jobId,
        title: sample.title,
        language: sample.language,
        created_at: sample.createdAt,
        char_count: sample.charCount,
        preview: sample.preview,
      })),
    });
  }),
);

router.get(
  "/dev/transcript-samples/:job_id",
  asyncHandler(async (req, res) => {
    requireDatabaseBackedJobs("/v1/dev/transcript-samples/:job_id");
    const user = getUser(req);
    const sample = await getTranscriptSampleByJobId(req.params.job_id, user.id);
    if (!sample) {
      throw new ApiError(404, "NOT_FOUND", "Transcript sample not found.");
    }
    res.status(200).json({
      sample: {
        job_id: sample.jobId,
        title: sample.title,
        language: sample.language,
        created_at: sample.createdAt,
        char_count: sample.charCount,
        preview: sample.preview,
        transcript_text: sample.transcriptText,
      },
    });
  }),
);

export { router as v1Router };
