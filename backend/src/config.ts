import dotenv from "dotenv";

dotenv.config();

const LLM_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_MODEL = "google/gemini-2.0-flash-001";
const LLM_TIMEOUT_MS = 90000;
const LLM_INPUT_MAX_CHARS = 80000;

export function resolveLlmConfig(env: NodeJS.ProcessEnv) {
  return {
    llmApiKey: env.OPENROUTER_API_KEY ?? env.OPENAI_API_KEY ?? "",
    llmBaseUrl: LLM_BASE_URL,
    llmModel: LLM_MODEL,
    llmTimeoutMs: LLM_TIMEOUT_MS,
    llmInputMaxChars: LLM_INPUT_MAX_CHARS,
  };
}

const llmConfig = resolveLlmConfig(process.env);

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseEnabled: Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 8080)}`,
  ...llmConfig,
};
