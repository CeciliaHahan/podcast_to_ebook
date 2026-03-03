import { ApiClient } from "./client";
import type {
  CreateTranscriptJobRequest,
  JobAcceptedResponse,
  JobArtifactsResponse,
  JobInspectorResponse,
  JobStatusResponse,
} from "./types";

export class JobsApi {
  constructor(private readonly client: ApiClient) {}

  createFromTranscript(payload: CreateTranscriptJobRequest): Promise<JobAcceptedResponse> {
    return this.client.post("/v1/jobs/from-transcript", payload);
  }

  getJob(jobId: string): Promise<JobStatusResponse> {
    return this.client.get(`/v1/jobs/${jobId}`);
  }

  getArtifacts(jobId: string): Promise<JobArtifactsResponse> {
    return this.client.get(`/v1/jobs/${jobId}/artifacts`);
  }

  getInspector(jobId: string): Promise<JobInspectorResponse> {
    return this.client.get(`/v1/jobs/${jobId}/inspector`);
  }
}
