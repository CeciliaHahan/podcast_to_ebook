import { ApiError } from "../lib/errors.js";
import {
  countActiveJobs,
  countDailyJobs,
  createArtifacts,
  createJob,
  failStaleActiveJobs,
  setJobInspectorTrace,
  updateJobStatusAndStage,
} from "../repositories/jobsRepo.js";
import type { InspectorPushInput, InspectorStageRecord } from "../repositories/jobsRepo.js";
import type { CreateJobInput, OutputFormat, SourceType } from "../types/domain.js";

const MAX_TRANSCRIPT_CHARS = 120_000;
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 180 * 60;
const MAX_ACTIVE_JOBS_PER_USER = 2;
const MAX_DAILY_JOBS_PER_USER = 10;
const ACTIVE_JOB_STALE_TIMEOUT_MINUTES = 15;
const DEFAULT_TEMPLATE_ID = "templateA-v0-book";

const ACCEPTANCE_COPY =
  "Generated outputs are for personal use or explicitly authorized use only. For personal use only. No commercial usage is allowed here.";

function assertCompliance(input: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean }) {
  if (!input.for_personal_or_authorized_use_only || !input.no_commercial_use) {
    throw new ApiError(400, "FORBIDDEN", "Compliance declaration must be accepted.");
  }
}

async function assertUserQuota(userId: string) {
  const [daily, initialActive] = await Promise.all([countDailyJobs(userId), countActiveJobs(userId)]);
  let active = initialActive;
  if (active >= MAX_ACTIVE_JOBS_PER_USER) {
    const reclaimed = await failStaleActiveJobs(userId, ACTIVE_JOB_STALE_TIMEOUT_MINUTES);
    if (reclaimed > 0) {
      active = await countActiveJobs(userId);
    }
  }
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

function previewText(input: string, maxChars = 3000): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}\n... <truncated>`;
}

async function runPipelineInline(params: {
  jobId: string;
  sourceType: SourceType;
  title?: string;
  language?: string;
  templateId: string;
  outputFormats: OutputFormat[];
  sourceRef?: string;
  rawInput: CreateJobInput["rawInput"];
}) {
  const stages: InspectorStageRecord[] = [];
  const pushStage = (stage: InspectorPushInput) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };

  const transcriptText =
    typeof params.rawInput.metadata?.transcript_text === "string" ? params.rawInput.metadata.transcript_text : "";

  pushStage({
    stage: "transcript",
    input: {
      source_type: params.sourceType,
      source_ref: params.sourceRef ?? null,
      transcript_chars: transcriptText.length,
      transcript_preview: previewText(transcriptText, 2500),
    },
    config: {
      template_id: params.templateId,
      output_formats: params.outputFormats,
    },
    notes:
      transcriptText.length > 0
        ? undefined
        : "No transcript text present in this input; downstream stages run with empty transcript body.",
  });

  await updateJobStatusAndStage({
    jobId: params.jobId,
    status: "processing",
    stage: "pipeline",
    progress: 35,
  });

  try {
    await createArtifacts({
      jobId: params.jobId,
      formats: params.outputFormats,
      title: params.title ?? "Podcast Notes",
      language: params.language ?? "zh-CN",
      transcriptText,
      templateId: params.templateId,
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      inspector: pushStage,
    });

    await updateJobStatusAndStage({
      jobId: params.jobId,
      status: "succeeded",
      stage: "completed",
      progress: 100,
    });
  } catch (error) {
    pushStage({
      stage: "normalization",
      notes: `Pipeline failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    await updateJobStatusAndStage({
      jobId: params.jobId,
      status: "failed",
      stage: "failed",
      progress: 100,
      errorCode: "GENERATION_FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown processing error",
    });
    throw error;
  } finally {
    await setJobInspectorTrace(params.jobId, stages);
  }
}

async function createAndRunJob(params: {
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

  const resolvedTemplateId = params.templateId ?? DEFAULT_TEMPLATE_ID;
  const outputFormats = normalizeOutputFormats(params.outputFormats);

  const job = await createJob({
    userId: params.userId,
    sourceType: params.sourceType,
    title: params.title,
    language: params.language,
    templateId: resolvedTemplateId,
    outputFormats,
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

  if (job.status === "queued") {
    await runPipelineInline({
      jobId: job.jobId,
      sourceType: params.sourceType,
      title: params.title,
      language: params.language,
      templateId: resolvedTemplateId,
      outputFormats,
      sourceRef: params.sourceRef,
      rawInput: params.rawInput,
    });
  }

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

  return createAndRunJob({
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
  return createAndRunJob({
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
  return createAndRunJob({
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

  return createAndRunJob({
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
