import type { JobStatus, SourceType } from "../types/domain.js";
import { ApiError } from "../lib/errors.js";

const transitionMap: Record<JobStatus, JobStatus[]> = {
  queued: ["processing", "canceled"],
  processing: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export function assertStatusTransition(from: JobStatus, to: JobStatus) {
  if (!transitionMap[from].includes(to)) {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", `Cannot move job from ${from} to ${to}.`);
  }
}

export const stageProgress: Record<string, number> = {
  queued: 5,
  input_validation: 10,
  ingestion: 20,
  transcription: 45,
  normalization: 55,
  chapter_structuring: 70,
  render_epub: 80,
  render_pdf: 88,
  render_md: 94,
  packaging: 99,
  completed: 100,
};

export function stageSequenceFor(sourceType: SourceType): string[] {
  const base = ["input_validation", "normalization", "chapter_structuring"];
  if (sourceType === "audio") {
    return ["input_validation", "ingestion", "transcription", ...base.slice(1), "render_epub", "render_pdf", "render_md", "packaging", "completed"];
  }
  if (sourceType === "rss" || sourceType === "link") {
    return ["input_validation", "ingestion", ...base.slice(1), "render_epub", "render_pdf", "render_md", "packaging", "completed"];
  }
  return ["input_validation", "normalization", "chapter_structuring", "render_epub", "render_pdf", "render_md", "packaging", "completed"];
}
