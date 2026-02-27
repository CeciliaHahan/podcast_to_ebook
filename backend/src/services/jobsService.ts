import { ApiError } from "../lib/errors.js";
import { countActiveJobs, countDailyJobs, createJob } from "../repositories/jobsRepo.js";
import { enqueueJob } from "./jobQueue.js";
import type { CreateJobInput, OutputFormat, SourceType } from "../types/domain.js";

const MAX_TRANSCRIPT_CHARS = 120_000;
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 180 * 60;
const MAX_ACTIVE_JOBS_PER_USER = 2;
const MAX_DAILY_JOBS_PER_USER = 10;
const DEFAULT_TEMPLATE_ID = "templateA-v0-book";

const ACCEPTANCE_COPY =
  "Generated outputs are for personal use or explicitly authorized use only. For personal use only. No commercial usage is allowed here.";

function assertCompliance(input: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean }) {
  if (!input.for_personal_or_authorized_use_only || !input.no_commercial_use) {
    throw new ApiError(400, "FORBIDDEN", "Compliance declaration must be accepted.");
  }
}

async function assertUserQuota(userId: string) {
  const [active, daily] = await Promise.all([countActiveJobs(userId), countDailyJobs(userId)]);
  if (active >= MAX_ACTIVE_JOBS_PER_USER) {
    throw new ApiError(429, "ACTIVE_JOB_LIMIT_EXCEEDED", "Too many active jobs. Try again later.");
  }
  if (daily >= MAX_DAILY_JOBS_PER_USER) {
    throw new ApiError(429, "DAILY_QUOTA_EXCEEDED", "Daily quota exceeded.");
  }
}

function normalizeOutputFormats(formats: OutputFormat[]): OutputFormat[] {
  const unique = Array.from(new Set(formats));
  if (unique.length === 0) {
    throw new ApiError(400, "INVALID_INPUT", "At least one output format is required.");
  }
  return unique;
}

async function createAndQueueJob(params: {
  userId: string;
  sourceType: SourceType;
  title?: string;
  language?: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  sourceRef?: string;
  inputCharCount?: number;
  inputDurationSeconds?: number;
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  rawInput: CreateJobInput["rawInput"];
  requestIp?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}) {
  await assertUserQuota(params.userId);
  assertCompliance(params.compliance);
  const job = await createJob({
    userId: params.userId,
    sourceType: params.sourceType,
    title: params.title,
    language: params.language,
    templateId: params.templateId ?? DEFAULT_TEMPLATE_ID,
    outputFormats: normalizeOutputFormats(params.outputFormats),
    sourceRef: params.sourceRef,
    inputCharCount: params.inputCharCount,
    inputDurationSeconds: params.inputDurationSeconds,
    compliance: {
      forPersonalOrAuthorizedUseOnly: params.compliance.for_personal_or_authorized_use_only,
      noCommercialUse: params.compliance.no_commercial_use,
    },
    rawInput: params.rawInput,
    acceptanceCopy: ACCEPTANCE_COPY,
    requestIp: params.requestIp,
    userAgent: params.userAgent,
    idempotencyKey: params.idempotencyKey,
  });

  void enqueueJob(job.jobId, params.sourceType);
  return job;
}

export async function createTranscriptJob(params: {
  userId: string;
  title: string;
  language: string;
  transcriptText: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  metadata?: Record<string, unknown>;
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  requestIp?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}) {
  if (params.transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    throw new ApiError(400, "INVALID_INPUT", `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`);
  }

  return createAndQueueJob({
    userId: params.userId,
    sourceType: "transcript",
    title: params.title,
    language: params.language,
    templateId: params.templateId,
    outputFormats: params.outputFormats,
    sourceRef: typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined,
    inputCharCount: params.transcriptText.length,
    compliance: params.compliance,
    rawInput: {
      metadata: {
        ...(params.metadata ?? {}),
        transcript_text: params.transcriptText,
      },
      transcriptStorageUri: `memory://transcripts/${Date.now()}`,
    },
    requestIp: params.requestIp,
    userAgent: params.userAgent,
    idempotencyKey: params.idempotencyKey,
  });
}

export async function createRssJob(params: {
  userId: string;
  rssUrl: string;
  episodeId: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  requestIp?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}) {
  return createAndQueueJob({
    userId: params.userId,
    sourceType: "rss",
    templateId: params.templateId,
    outputFormats: params.outputFormats,
    sourceRef: `${params.rssUrl}#${params.episodeId}`,
    compliance: params.compliance,
    rawInput: {
      rssUrl: params.rssUrl,
      rssEpisodeId: params.episodeId,
    },
    requestIp: params.requestIp,
    userAgent: params.userAgent,
    idempotencyKey: params.idempotencyKey,
  });
}

export async function createLinkJob(params: {
  userId: string;
  episodeUrl: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  requestIp?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}) {
  return createAndQueueJob({
    userId: params.userId,
    sourceType: "link",
    templateId: params.templateId,
    outputFormats: params.outputFormats,
    sourceRef: params.episodeUrl,
    compliance: params.compliance,
    rawInput: {
      episodeUrl: params.episodeUrl,
    },
    requestIp: params.requestIp,
    userAgent: params.userAgent,
    idempotencyKey: params.idempotencyKey,
  });
}

export async function createAudioJob(params: {
  userId: string;
  fileName: string;
  fileSize: number;
  durationSeconds?: number;
  title?: string;
  language?: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  requestIp?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}) {
  if (params.fileSize > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "AUDIO_TOO_LARGE", "Audio file exceeds 300MB limit.");
  }
  if (typeof params.durationSeconds === "number" && params.durationSeconds > MAX_AUDIO_SECONDS) {
    throw new ApiError(400, "AUDIO_TOO_LONG", "Audio exceeds 180 minutes.");
  }

  return createAndQueueJob({
    userId: params.userId,
    sourceType: "audio",
    title: params.title,
    language: params.language,
    templateId: params.templateId,
    outputFormats: params.outputFormats,
    sourceRef: params.fileName,
    inputDurationSeconds: params.durationSeconds,
    compliance: params.compliance,
    rawInput: {
      audioStorageUri: `memory://audio/${Date.now()}-${params.fileName}`,
    },
    requestIp: params.requestIp,
    userAgent: params.userAgent,
    idempotencyKey: params.idempotencyKey,
  });
}

export function getServiceLimits() {
  return {
    maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
    maxAudioBytes: MAX_AUDIO_BYTES,
    maxAudioSeconds: MAX_AUDIO_SECONDS,
    maxActiveJobsPerUser: MAX_ACTIVE_JOBS_PER_USER,
    maxDailyJobsPerUser: MAX_DAILY_JOBS_PER_USER,
  };
}
