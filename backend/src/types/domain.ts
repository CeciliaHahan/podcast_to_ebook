export type OutputFormat = "epub" | "pdf" | "md";

export type AuthUser = {
  id: string;
  email: string;
};

export type InspectorStageName =
  | "transcript"
  | "llm_request"
  | "llm_response"
  | "normalization"
  | "pdf"
  | "epub";

export type InspectorStageRecord = {
  stage: InspectorStageName;
  ts: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  config?: Record<string, unknown>;
  notes?: string;
};

export type InspectorPushInput = Omit<InspectorStageRecord, "ts">;
