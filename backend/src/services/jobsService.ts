import { ApiError } from "../lib/errors.js";
import {
  appendJobInspectorStage,
  createArtifacts,
  createJob,
  setJobInspectorTrace,
  updateJobStatusAndStage,
} from "../repositories/jobsRepo.js";
import type { GenerationMethod, InspectorPushInput, InspectorStageRecord } from "../repositories/jobsRepo.js";
import type { CreateJobInput, OutputFormat } from "../types/domain.js";

const MAX_TRANSCRIPT_CHARS = 120_000;
const DEFAULT_TEMPLATE_ID = "templateA-v0-book";
const OUTPUT_FORMAT_PRIORITY: OutputFormat[] = ["epub", "pdf", "md"];

const ACCEPTANCE_COPY =
  "Generated outputs are for personal use or explicitly authorized use only. For personal use only. No commercial usage is allowed here.";

const liveInspectorStagesByJobId = new Map<string, InspectorStageRecord[]>();

function assertCompliance(input: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean }) {
  if (!input.for_personal_or_authorized_use_only || !input.no_commercial_use) {
    throw new ApiError(400, "FORBIDDEN", "Compliance declaration must be accepted.");
  }
}

function normalizeOutputFormats(formats: OutputFormat[]): OutputFormat[] {
  const priority = new Map<OutputFormat, number>(OUTPUT_FORMAT_PRIORITY.map((format, index) => [format, index]));
  const unique = Array.from(new Set(formats));
  if (unique.length === 0) {
    throw new ApiError(400, "INVALID_INPUT", "At least one output format is required.");
  }
  return unique.sort((left, right) => (priority.get(left) ?? 100) - (priority.get(right) ?? 100));
}

function previewText(input: string, maxChars = 3000): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}\n... <truncated>`;
}

function sanitizeArtifactTitle(input: string | undefined, fallback = "Podcast Notes"): string {
  const raw = (input ?? "").trim();
  if (!raw) {
    return fallback;
  }
  const clean = raw
    .replace(/^\s*(?:>\s*)?[#]{1,6}\s*/, "")
    .replace(/^\s*[\-\*•]\s*/, "")
    .replace(/^\s*[\*_"'`~]{1,3}\s*/, "")
    .replace(/\s*[\*_"'`~]{1,3}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}

function readGenerationMethod(_value: unknown): GenerationMethod {
  return "C";
}

async function runPipelineInline(params: {
  jobId: string;
  title?: string;
  language?: string;
  templateId: string;
  outputFormats: OutputFormat[];
  sourceRef?: string;
  rawInput: CreateJobInput["rawInput"];
}) {
  const stages: InspectorStageRecord[] = [];
  liveInspectorStagesByJobId.set(params.jobId, stages);
  const pushStage = (stage: InspectorPushInput) => {
    const record: InspectorStageRecord = {
      ...stage,
      ts: new Date().toISOString(),
    };
    stages.push(record);
    void appendJobInspectorStage(params.jobId, record).catch((error) => {
      // eslint-disable-next-line no-console
      console.error(
        `[jobsService] failed to append live inspector stage for ${params.jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const transcriptText =
    typeof params.rawInput.metadata?.transcript_text === "string" ? params.rawInput.metadata.transcript_text : "";
  const generationMethod = readGenerationMethod(params.rawInput.metadata?.generation_method);

  pushStage({
    stage: "transcript",
    input: {
      source_type: "transcript",
      source_ref: params.sourceRef ?? null,
      transcript_chars: transcriptText.length,
      transcript_preview: previewText(transcriptText, 2500),
    },
    config: {
      template_id: params.templateId,
      output_formats: params.outputFormats,
      generation_method: generationMethod,
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
      sourceType: "transcript",
      sourceRef: params.sourceRef,
      generationMethod,
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
    liveInspectorStagesByJobId.delete(params.jobId);
  }
}

async function createAndRunJob(params: {
  userId: string;
  title?: string;
  language?: string;
  templateId?: string;
  outputFormats: OutputFormat[];
  runMode?: "inline" | "background";
  sourceRef?: string;
  inputCharCount?: number;
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
  rawInput: CreateJobInput["rawInput"];
}) {
  assertCompliance(params.compliance);

  const resolvedTitle = sanitizeArtifactTitle(params.title, "Podcast Notes");
  const resolvedTemplateId = params.templateId ?? DEFAULT_TEMPLATE_ID;
  const outputFormats = normalizeOutputFormats(params.outputFormats);
  const runMode = params.runMode ?? "inline";

  const job = await createJob({
    userId: params.userId,
    title: resolvedTitle,
    language: params.language,
    templateId: resolvedTemplateId,
    outputFormats,
    sourceRef: params.sourceRef,
    inputCharCount: params.inputCharCount,
    compliance: {
      forPersonalOrAuthorizedUseOnly: params.compliance.for_personal_or_authorized_use_only,
      noCommercialUse: params.compliance.no_commercial_use,
    },
    rawInput: params.rawInput,
    acceptanceCopy: ACCEPTANCE_COPY,
  });

  if (job.status === "queued") {
    const runPipeline = async () => {
      await runPipelineInline({
        jobId: job.jobId,
        title: resolvedTitle,
        language: params.language,
        templateId: resolvedTemplateId,
        outputFormats,
        sourceRef: params.sourceRef,
        rawInput: params.rawInput,
      });
    };

    if (runMode === "background") {
      void runPipeline().catch((error) => {
        // eslint-disable-next-line no-console
        console.error(
          `[jobsService] background pipeline failed for ${job.jobId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return job;
    }

    await runPipeline();
    return { ...job, status: "succeeded" as const };
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
  runMode?: "inline" | "background";
  metadata?: Record<string, unknown>;
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
}) {
  if (params.transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    throw new ApiError(400, "INVALID_INPUT", `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`);
  }

  return createAndRunJob({
    userId: params.userId,
    title: params.title,
    language: params.language,
    templateId: params.templateId,
    outputFormats: params.outputFormats,
    runMode: params.runMode,
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
  });
}

export function getServiceLimits() {
  return {
    maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
  };
}

export function getLiveJobInspectorTrace(jobId: string): InspectorStageRecord[] | null {
  const stages = liveInspectorStagesByJobId.get(jobId);
  if (!stages) {
    return null;
  }
  return [...stages];
}
