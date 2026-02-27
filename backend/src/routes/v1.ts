import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/errors.js";
import { getJobById, listArtifacts, listJobEvents } from "../repositories/jobsRepo.js";
import {
  createAudioJob,
  createLinkJob,
  createRssJob,
  createTranscriptJob,
  getServiceLimits,
} from "../services/jobsService.js";
import type { OutputFormat } from "../types/domain.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getServiceLimits().maxAudioBytes },
});

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

const createFromRssSchema = z.object({
  rss_url: z.string().url(),
  episode_id: z.string().min(1),
  template_id: z.string().default("templateA-v0-book"),
  output_formats: outputFormatSchema,
  compliance_declaration: complianceSchema,
});

const createFromLinkSchema = z.object({
  episode_url: z.string().url(),
  template_id: z.string().default("templateA-v0-book"),
  output_formats: outputFormatSchema,
  compliance_declaration: complianceSchema,
});

const rssParseSchema = z.object({
  rss_url: z.string().url(),
});

function getUser(req: Request): { id: string; email: string } {
  const user = req.authUser;
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return user;
}

function parseMaybeJson<T>(value: unknown, schema: z.ZodSchema<T>, fieldName: string): T {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_INPUT", `${fieldName} must be a JSON string.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError(400, "INVALID_INPUT", `${fieldName} is not valid JSON.`);
  }
  return schema.parse(parsed);
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

router.post(
  "/rss/parse",
  asyncHandler(async (req, res) => {
    rssParseSchema.parse(req.body);
    res.status(200).json({
      podcast: {
        title: "Parsed Podcast",
        author: "Unknown",
        language: "zh-CN",
      },
      episodes: [
        {
          episode_id: "ep_001",
          title: "Episode 1",
          published_at: new Date().toISOString(),
          audio_url: "https://cdn.example.com/ep1.mp3",
          link: "https://example.com/episodes/1",
        },
        {
          episode_id: "ep_002",
          title: "Episode 2",
          published_at: new Date(Date.now() - 86400 * 1000).toISOString(),
          audio_url: "https://cdn.example.com/ep2.mp3",
          link: "https://example.com/episodes/2",
        },
      ],
    });
  }),
);

router.post(
  "/jobs/from-rss",
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const parsed = createFromRssSchema.parse(req.body);
    const job = await createRssJob({
      userId: user.id,
      rssUrl: parsed.rss_url,
      episodeId: parsed.episode_id,
      templateId: parsed.template_id,
      outputFormats: parsed.output_formats,
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

router.post(
  "/jobs/from-link",
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const parsed = createFromLinkSchema.parse(req.body);
    const job = await createLinkJob({
      userId: user.id,
      episodeUrl: parsed.episode_url,
      templateId: parsed.template_id,
      outputFormats: parsed.output_formats,
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

router.post(
  "/jobs/from-audio",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    if (!req.file) {
      throw new ApiError(400, "INVALID_INPUT", "file is required.");
    }

    const outputFormatsRaw = req.body.output_formats;
    const complianceRaw = req.body.compliance_declaration;
    const outputFormats = parseMaybeJson<OutputFormat[]>(
      outputFormatsRaw,
      outputFormatSchema,
      "output_formats",
    );
    const compliance = parseMaybeJson(complianceRaw, complianceSchema, "compliance_declaration");
    const durationSeconds = req.body.duration_seconds ? Number(req.body.duration_seconds) : undefined;

    const job = await createAudioJob({
      userId: user.id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      title: req.body.title || undefined,
      language: req.body.language || undefined,
      templateId: req.body.template_id || undefined,
      outputFormats,
      compliance,
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
  "/jobs/:job_id/events",
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const job = await getJobById(req.params.job_id, user.id);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "Job not found.");
    }
    const events = await listJobEvents(job.id);
    res.status(200).json({
      job_id: job.id,
      events: events.map((event) => ({
        ts: event.created_at,
        stage: event.stage,
        message: event.message,
      })),
    });
  }),
);

export { router as v1Router };
