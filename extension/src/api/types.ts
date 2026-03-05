export type OutputFormat = "epub" | "pdf" | "md";

export type ComplianceDeclaration = {
  for_personal_or_authorized_use_only: true;
  no_commercial_use: true;
};

export type CreateEpubFromTranscriptResponse = {
  job_id: string;
  status: "succeeded";
  created_at: string;
  artifacts: Array<{
    type: OutputFormat;
    file_name: string;
    size_bytes: number;
    download_url: string;
    expires_at: string;
  }>;
  stages: Array<{
    stage: string;
    ts: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    config?: Record<string, unknown>;
    notes?: string;
  }>;
  traceability?: {
    source_type: "transcript";
    source_ref: string;
    generated_at: string;
  };
};

export type CreateEpubFromTranscriptRequest = {
  title: string;
  language: string;
  transcript_text: string;
  template_id?: string;
  metadata?: Record<string, unknown>;
  compliance_declaration: ComplianceDeclaration;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};
