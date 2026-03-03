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

export type JobInspectorResponse = {
  job_id: string;
  stages: Array<{
    stage: string;
    ts: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    config?: Record<string, unknown>;
    notes?: string;
  }>;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};
