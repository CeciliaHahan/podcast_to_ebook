import { setTimeout as delay } from "node:timers/promises";
import { stageProgress, stageSequenceFor } from "../domain/jobStateMachine.js";
import {
  appendJobEvent,
  createArtifacts,
  getJobByIdAny,
  getJobInputByJobId,
  updateJobStatusAndStage,
} from "../repositories/jobsRepo.js";
import type { SourceType } from "../types/domain.js";

const processingJobs = new Set<string>();

export async function enqueueJob(jobId: string, sourceType: SourceType) {
  if (processingJobs.has(jobId)) {
    return;
  }
  processingJobs.add(jobId);
  queueMicrotask(() => {
    void processJob(jobId, sourceType).finally(() => {
      processingJobs.delete(jobId);
    });
  });
}

async function processJob(jobId: string, sourceType: SourceType) {
  try {
    await updateJobStatusAndStage({
      jobId,
      status: "processing",
      stage: "queued",
      progress: stageProgress.queued,
    });
    await appendJobEvent({ jobId, stage: "queued", message: "Started processing", level: "info" });

    const stages = stageSequenceFor(sourceType);
    for (const stage of stages) {
      if (stage === "completed") {
        continue;
      }
      await delay(150);
      await updateJobStatusAndStage({
        jobId,
        status: "processing",
        stage,
        progress: stageProgress[stage] ?? 0,
      });
      await appendJobEvent({ jobId, stage, message: "Completed", level: "info" });
    }

    const job = await getJobByIdAny(jobId);
    if (!job) {
      return;
    }
    const jobInput = await getJobInputByJobId(jobId);
    const metadata = jobInput?.metadata ?? {};
    const transcriptText = typeof metadata.transcript_text === "string" ? metadata.transcript_text : "";
    const sourceRefCandidates = [
      jobInput?.episodeUrl,
      jobInput?.rssUrl,
      typeof metadata.source_ref === "string" ? metadata.source_ref : null,
    ];
    const sourceRef = job.sourceRef ?? sourceRefCandidates.find((value): value is string => Boolean(value && value.trim()));

    await createArtifacts({
      jobId,
      formats: job.outputFormats,
      title: job.title ?? "Podcast Notes",
      language: job.language ?? "zh-CN",
      transcriptText,
      templateId: job.templateId,
      sourceType: job.sourceType,
      sourceRef,
    });

    await updateJobStatusAndStage({
      jobId,
      status: "succeeded",
      stage: "completed",
      progress: 100,
    });
    await appendJobEvent({ jobId, stage: "completed", message: "Job succeeded", level: "info" });
  } catch (error) {
    await updateJobStatusAndStage({
      jobId,
      status: "failed",
      stage: "processing",
      progress: 100,
      errorCode: "GENERATION_FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown processing error",
    });
    await appendJobEvent({
      jobId,
      stage: "processing",
      message: "Job failed",
      level: "error",
      details: { reason: error instanceof Error ? error.message : "Unknown" },
    });
  }
}
