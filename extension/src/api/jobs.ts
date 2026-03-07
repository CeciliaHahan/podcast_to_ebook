import { ApiClient } from "./client";
import type {
  CreateEpubFromTranscriptRequest,
  CreateEpubFromTranscriptResponse,
} from "./types";

export class JobsApi {
  constructor(private readonly client: ApiClient) {}

  createEpubFromTranscript(
    payload: CreateEpubFromTranscriptRequest,
  ): Promise<CreateEpubFromTranscriptResponse> {
    return this.client.post("/v1/epub/from-transcript", payload);
  }
}
