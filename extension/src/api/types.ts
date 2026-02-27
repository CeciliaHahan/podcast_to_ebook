export type OutputFormat = "epub" | "pdf" | "md";
export type JobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";

export type ComplianceDeclaration = {
  for_personal_or_authorized_use_only: true;
  no_commercial_use: true;
};

export type JobAcceptedResponse = {
  job_id: string;
  status: "queued";
  created_at: string;
};

export type CreateTranscriptJobRequest = {
  title: string;
  language: string;
  transcript_text: string;
  template_id?: string;
  output_formats: OutputFormat[];
  metadata?: Record<string, unknown>;
  compliance_declaration: ComplianceDeclaration;
};

export type CreateRssJobRequest = {
  rss_url: string;
  episode_id: string;
  template_id?: string;
  output_formats: OutputFormat[];
  compliance_declaration: ComplianceDeclaration;
};

export type CreateLinkJobRequest = {
  episode_url: string;
  template_id?: string;
  output_formats: OutputFormat[];
  compliance_declaration: ComplianceDeclaration;
};

export type ParseRssRequest = {
  rss_url: string;
};

export type ParseRssResponse = {
  podcast: {
    title: string;
    author?: string;
    language?: string;
  };
  episodes: Array<{
    episode_id: string;
    title: string;
    published_at?: string;
    audio_url?: string;
    link?: string;
  }>;
};

export type JobStatusResponse = {
  job_id: string;
  status: JobStatus;
  progress?: number;
  stage?: string;
  created_at?: string;
  updated_at?: string;
  error?: {
    code: string;
    message: string;
  } | null;
};

export type JobArtifactsResponse = {
  job_id: string;
  status: JobStatus;
  artifacts: Array<{
    type: OutputFormat;
    file_name: string;
    size_bytes: number;
    download_url: string;
    expires_at: string;
  }>;
  traceability?: {
    source_type: "transcript" | "audio" | "rss" | "link";
    source_ref: string;
    generated_at: string;
  };
};

export type JobEventsResponse = {
  job_id: string;
  events: Array<{
    ts: string;
    stage: string;
    message: string;
  }>;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};
