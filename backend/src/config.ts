import dotenv from "dotenv";

dotenv.config();

const OPENROUTER_DEFAULT_MODEL = "google/gemini-3-flash";
const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function looksLikeOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.includes("openrouter.ai");
  } catch {
    return /openrouter/i.test(baseUrl);
  }
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv) {
  const llmApiKey = env.OPENROUTER_API_KEY ?? env.OPENAI_API_KEY ?? "";
  const llmBaseUrl =
    env.OPENROUTER_BASE_URL ??
    env.OPENAI_BASE_URL ??
    (env.OPENROUTER_API_KEY ? OPENROUTER_DEFAULT_BASE_URL : OPENAI_DEFAULT_BASE_URL);
  const useOpenRouterDefaults =
    Boolean(env.OPENROUTER_API_KEY || env.OPENROUTER_BASE_URL) || looksLikeOpenRouterBaseUrl(llmBaseUrl);

  return {
    llmApiKey,
    llmBaseUrl,
    llmModel:
      env.OPENROUTER_MODEL ??
      env.OPENAI_MODEL ??
      (useOpenRouterDefaults ? OPENROUTER_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL),
    llmTimeoutMs: Number(env.OPENROUTER_TIMEOUT_MS ?? env.OPENAI_TIMEOUT_MS ?? 45000),
    llmInputMaxChars: Number(env.OPENROUTER_INPUT_MAX_CHARS ?? env.OPENAI_INPUT_MAX_CHARS ?? 80000),
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
