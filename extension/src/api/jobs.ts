import { ApiClient } from "./client";
import type {
  CreateLinkJobRequest,
  CreateRssJobRequest,
  CreateTranscriptJobRequest,
  JobAcceptedResponse,
  JobArtifactsResponse,
  JobEventsResponse,
  JobStatusResponse,
  ParseRssRequest,
  ParseRssResponse,
} from "./types";

export class JobsApi {
  constructor(private readonly client: ApiClient) {}

  createFromTranscript(payload: CreateTranscriptJobRequest): Promise<JobAcceptedResponse> {
    return this.client.post("/v1/jobs/from-transcript", payload);
  }

  parseRss(payload: ParseRssRequest): Promise<ParseRssResponse> {
    return this.client.post("/v1/rss/parse", payload);
  }

  createFromRss(payload: CreateRssJobRequest): Promise<JobAcceptedResponse> {
    return this.client.post("/v1/jobs/from-rss", payload);
  }

  createFromLink(payload: CreateLinkJobRequest): Promise<JobAcceptedResponse> {
    return this.client.post("/v1/jobs/from-link", payload);
  }

  createFromAudio(payload: {
    file: File;
    title?: string;
    language?: string;
    durationSeconds?: number;
    templateId?: string;
    outputFormatsJson: string;
    complianceDeclarationJson: string;
  }): Promise<JobAcceptedResponse> {
    const form = new FormData();
    form.append("file", payload.file);
    if (payload.title) form.append("title", payload.title);
    if (payload.language) form.append("language", payload.language);
    if (typeof payload.durationSeconds === "number") {
      form.append("duration_seconds", String(payload.durationSeconds));
    }
    if (payload.templateId) form.append("template_id", payload.templateId);
    form.append("output_formats", payload.outputFormatsJson);
    form.append("compliance_declaration", payload.complianceDeclarationJson);
    return this.client.postForm("/v1/jobs/from-audio", form);
  }

  getJob(jobId: string): Promise<JobStatusResponse> {
    return this.client.get(`/v1/jobs/${jobId}`);
  }

  getArtifacts(jobId: string): Promise<JobArtifactsResponse> {
    return this.client.get(`/v1/jobs/${jobId}/artifacts`);
  }

  getEvents(jobId: string): Promise<JobEventsResponse> {
    return this.client.get(`/v1/jobs/${jobId}/events`);
  }
}
