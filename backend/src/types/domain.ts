export type SourceType = "transcript" | "audio" | "rss" | "link";
export type JobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";
export type OutputFormat = "epub" | "pdf" | "md";

export type AuthUser = {
  id: string;
  email: string;
};

export type CreateJobInput = {
  userId: string;
  sourceType: SourceType;
  title?: string;
  language?: string;
  templateId: string;
  outputFormats: OutputFormat[];
  sourceRef?: string;
  inputCharCount?: number;
  inputDurationSeconds?: number;
  compliance: {
    forPersonalOrAuthorizedUseOnly: boolean;
    noCommercialUse: boolean;
  };
  rawInput: {
    transcriptStorageUri?: string;
    audioStorageUri?: string;
    rssUrl?: string;
    rssEpisodeId?: string;
    episodeUrl?: string;
    metadata?: Record<string, unknown>;
  };
  acceptanceCopy: string;
};
