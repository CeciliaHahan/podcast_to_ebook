import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 8080)}`,
  llmApiKey: process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmBaseUrl:
    process.env.OPENROUTER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"),
  llmModel: process.env.OPENROUTER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  llmTimeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? 45000),
  llmInputMaxChars: Number(process.env.OPENROUTER_INPUT_MAX_CHARS ?? process.env.OPENAI_INPUT_MAX_CHARS ?? 80000),
};
