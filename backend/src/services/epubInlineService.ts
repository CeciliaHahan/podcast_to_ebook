import { ApiError } from "../lib/errors.js";
import { createId } from "../lib/ids.js";
import {
  createArtifactsEphemeral,
  type GenerationMethod,
  type InspectorPushInput,
  type InspectorStageRecord,
} from "../repositories/jobsRepo.js";

function assertCompliance(input: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean }) {
  if (!input.for_personal_or_authorized_use_only || !input.no_commercial_use) {
    throw new ApiError(400, "FORBIDDEN", "Compliance declaration must be accepted.");
  }
}

function sanitizeTitle(input: string, fallback = "Podcast Notes"): string {
  const raw = input.trim();
  if (!raw) {
    return fallback;
  }
  return raw.replace(/\s+/g, " ");
}

function previewText(input: string, maxChars = 2500): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}\n... <truncated>`;
}

function readGenerationMethod(_value: unknown): GenerationMethod {
  return "C";
}

export async function createEpubFromTranscriptInline(params: {
  title: string;
  language: string;
  transcriptText: string;
  templateId: string;
  metadata?: Record<string, unknown>;
  compliance: { for_personal_or_authorized_use_only: boolean; no_commercial_use: boolean };
}) {
  assertCompliance(params.compliance);
  const jobId = createId("run");
  const createdAt = new Date().toISOString();
  const resolvedTitle = sanitizeTitle(params.title);
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;
  const generationMethod = readGenerationMethod(params.metadata?.generation_method);
  const stages: InspectorStageRecord[] = [];
  const pushStage = (stage: InspectorPushInput) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };

  pushStage({
    stage: "transcript",
    input: {
      source_type: "transcript",
      source_ref: sourceRef ?? null,
      transcript_chars: params.transcriptText.length,
      transcript_preview: previewText(params.transcriptText),
    },
    config: {
      template_id: params.templateId,
      output_formats: ["epub"],
      generation_method: generationMethod,
    },
  });

  const artifacts = await createArtifactsEphemeral({
    jobId,
    formats: ["epub"],
    title: resolvedTitle,
    language: params.language,
    transcriptText: params.transcriptText,
    templateId: params.templateId,
    sourceType: "transcript",
    sourceRef,
    generationMethod,
    inspector: pushStage,
  });

  return {
    job_id: jobId,
    status: "succeeded" as const,
    created_at: createdAt,
    artifacts: artifacts.map((item) => ({
      type: item.type,
      file_name: item.fileName,
      size_bytes: item.sizeBytes,
      download_url: item.downloadUrl,
      expires_at: item.expiresAt,
    })),
    stages,
    traceability: {
      source_type: "transcript" as const,
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}
