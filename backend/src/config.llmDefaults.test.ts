import assert from "node:assert/strict";
import { resolveLlmConfig } from "./config.js";

type Case = {
  name: string;
  env: NodeJS.ProcessEnv;
  expected: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    inputMaxChars: number;
  };
};

const cases: Case[] = [
  {
    name: "openrouter key uses app-layer fixed llm settings",
    env: {
      OPENROUTER_API_KEY: "or-key",
    },
    expected: {
      apiKey: "or-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemini-3-flash-preview",
      timeoutMs: 90000,
      inputMaxChars: 80000,
    },
  },
  {
    name: "openai key fallback still works but settings stay fixed",
    env: {
      OPENAI_API_KEY: "oa-key",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_MODEL: "gpt-4.1-mini",
      OPENAI_TIMEOUT_MS: "9999",
      OPENAI_INPUT_MAX_CHARS: "123",
    },
    expected: {
      apiKey: "oa-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemini-3-flash-preview",
      timeoutMs: 90000,
      inputMaxChars: 80000,
    },
  },
  {
    name: "env overrides for model/base/timeout/input are ignored",
    env: {
      OPENROUTER_API_KEY: "or-key",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENROUTER_MODEL: "openai/gpt-4.1-mini",
      OPENROUTER_TIMEOUT_MS: "120000",
      OPENROUTER_INPUT_MAX_CHARS: "120000",
    },
    expected: {
      apiKey: "or-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemini-3-flash-preview",
      timeoutMs: 90000,
      inputMaxChars: 80000,
    },
  },
];

for (const testCase of cases) {
  const result = resolveLlmConfig(testCase.env);
  assert.equal(result.llmApiKey, testCase.expected.apiKey, `${testCase.name}: llmApiKey mismatch`);
  assert.equal(result.llmBaseUrl, testCase.expected.baseUrl, `${testCase.name}: llmBaseUrl mismatch`);
  assert.equal(result.llmModel, testCase.expected.model, `${testCase.name}: llmModel mismatch`);
  assert.equal(result.llmTimeoutMs, testCase.expected.timeoutMs, `${testCase.name}: llmTimeoutMs mismatch`);
  assert.equal(
    result.llmInputMaxChars,
    testCase.expected.inputMaxChars,
    `${testCase.name}: llmInputMaxChars mismatch`,
  );
}

console.log(`PASS: ${cases.length} config default-model cases`);
