export type OutputFormat = "epub" | "pdf" | "md";

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
};

export type WorkingNotes = {
  title: string;
  summary: string[];
  sections: Array<{
    heading: string;
    bullets: string[];
    excerpts: string[];
  }>;
};

export type BookletOutline = {
  title: string;
  sections: Array<{
    id: string;
    heading: string;
    goal?: string;
  }>;
};

export type BookletDraft = {
  title: string;
  sections: Array<{
    id: string;
    heading: string;
    body: string;
  }>;
};

export type CreateBookletDraftRequest = {
  title: string;
  language: string;
  working_notes: WorkingNotes;
  booklet_outline: BookletOutline;
  metadata?: Record<string, unknown>;
};

export type CreateEpubFromBookletDraftRequest = {
  title: string;
  language: string;
  booklet_draft: BookletDraft;
  metadata?: Record<string, unknown>;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};
