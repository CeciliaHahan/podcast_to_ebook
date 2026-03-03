import assert from "node:assert/strict";
import { resolveLlmConfig } from "./config.js";

type Case = {
  name: string;
  env: NodeJS.ProcessEnv;
  expected: {
    baseUrl: string;
    model: string;
  };
};

const cases: Case[] = [
  {
    name: "openrouter key defaults to openrouter base/model",
    env: {
      OPENROUTER_API_KEY: "or-key",
    },
    expected: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemini-3-flash",
    },
  },
  {
    name: "openai fallback defaults to openai base/model",
    env: {
      OPENAI_API_KEY: "oa-key",
    },
    expected: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
    },
  },
  {
    name: "openrouter base url selects openrouter default model",
    env: {
      OPENAI_API_KEY: "oa-key",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
    expected: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemini-3-flash",
    },
  },
  {
    name: "explicit OPENAI_MODEL overrides defaults",
    env: {
      OPENAI_API_KEY: "oa-key",
      OPENAI_MODEL: "gpt-4o-mini",
    },
    expected: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    },
  },
];

for (const testCase of cases) {
  const result = resolveLlmConfig(testCase.env);
  assert.equal(result.llmBaseUrl, testCase.expected.baseUrl, `${testCase.name}: llmBaseUrl mismatch`);
  assert.equal(result.llmModel, testCase.expected.model, `${testCase.name}: llmModel mismatch`);
}

console.log(`PASS: ${cases.length} config default-model cases`);
