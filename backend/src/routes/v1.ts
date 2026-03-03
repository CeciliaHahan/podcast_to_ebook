import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { getJobById, getJobInspectorTrace, listArtifacts } from "../repositories/jobsRepo.js";
import { createTranscriptJob, getServiceLimits } from "../services/jobsService.js";

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

function getUser(req: Request): { id: string; email: string } {
  const user = req.authUser;
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return user;
}

function requestMeta(req: Request) {
  return {
    requestIp: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    idempotencyKey: req.header("idempotency-key") ?? null,
  };
}

router.post(
  "/jobs/from-transcript",
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const parsed = transcriptRequestSchema.parse(req.body);
    const job = await createTranscriptJob({
      userId: user.id,
      title: parsed.title,
      language: parsed.language,
      transcriptText: parsed.transcript_text,
      templateId: parsed.template_id,
      outputFormats: parsed.output_formats,
      metadata: parsed.metadata,
      compliance: parsed.compliance_declaration,
      ...requestMeta(req),
    });
    res.status(202).json({
      job_id: job.jobId,
      status: job.status,
      created_at: job.createdAt,
    });
  }),
);

router.get(
  "/jobs/:job_id",
  asyncHandler(async (req, res) => {
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
      artifacts: artifacts.map((item) => ({
        type: item.type,
        file_name: item.fileName,
        size_bytes: item.sizeBytes,
        download_url: item.downloadUrl,
        expires_at: item.expiresAt,
      })),
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
    const user = getUser(req);
    const job = await getJobById(req.params.job_id, user.id);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "Job not found.");
    }
    const stages = await getJobInspectorTrace(job.id);
    res.status(200).json({
      job_id: job.id,
      stages,
    });
  }),
);

export { router as v1Router };
