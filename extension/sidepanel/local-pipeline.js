import { DEFAULT_PROMPTS, buildPrompt } from "./prompts.js";

// Try to load a gitignored config file with a pre-set API key.
// If config.local.js doesn't exist, fall back to empty (user enters key manually).
let _localApiKey = "";
try {
  const localConfig = await import("./config.local.js");
  _localApiKey = localConfig.LOCAL_API_KEY || "";
} catch {
  // config.local.js not present — that's fine, user sets key in settings.
}

export const DEFAULT_LLM_SETTINGS = {
  llmBaseUrl: "https://openrouter.ai/api/v1",
  llmModel: "google/gemini-3-flash-preview",
  llmApiKey: _localApiKey,
  reasoningEffort: "medium",
};

export const LLM_INPUT_MAX_CHARS = 80_000;
const LLM_TIMEOUT_MS = 90_000;
const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://chrome-extension.local/podcasts-to-ebooks",
  "X-Title": "Podcasts to Ebooks",
};
const SUPPORTED_LLM_HOSTS = new Set(["openrouter.ai", "api.openai.com"]);
const OPENROUTER_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

function createLocalId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function extractFirstJsonObject(input) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return input.slice(start, index + 1);
      }
    }
  }
  return null;
}

function cleanLine(input, maxLength = 180) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBodyText(input, maxLength = 4_000) {
  if (typeof input !== "string") {
    return "";
  }
  const text = input
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return text.slice(0, maxLength);
}

function readStringList(input, maxItems, maxItemLength) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const cleaned = cleanLine(item, maxItemLength);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function readSpeakerTextEntry(input, maxTextLength) {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    const cleaned = cleanLine(input, maxTextLength + 42);
    if (!cleaned) {
      return null;
    }
    const match = cleaned.match(/^([^：:\n]{1,24})[：:]\s*(.+)$/);
    if (!match) {
      return { text: cleanLine(cleaned, maxTextLength) };
    }
    const speaker = cleanLine(match[1], 40);
    const text = cleanLine(match[2], maxTextLength);
    if (!text) {
      return null;
    }
    return speaker ? { speaker, text } : { text };
  }
  if (typeof input !== "object") {
    return null;
  }
  const speaker = cleanLine(input.speaker, 40);
  const text = cleanLine(input.text, maxTextLength);
  if (!text) {
    return null;
  }
  return speaker ? { speaker, text } : { text };
}

function readSpeakerTextList(input, maxItems, maxTextLength) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const entry = readSpeakerTextEntry(item, maxTextLength);
    if (!entry) {
      continue;
    }
    const key = `${entry.speaker || ""}::${entry.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(entry);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function readWorkingNotesFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const summary = readStringList(root.summary, 7, 180);
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (const item of sectionsRaw.slice(0, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const heading = cleanLine(item.heading, 60);
    const claims = readStringList(item.claims || item.bullets, 6, 180);
    const evidence = readSpeakerTextList(item.evidence || item.excerpts, 5, 220);
    const sparks = readSpeakerTextList(item.sparks, 3, 220);
    const gist = cleanLine(item.gist, 240) || cleanLine(claims[0] || evidence[0]?.text || sparks[0]?.text, 240);
    if (!heading || !gist || (!claims.length && !evidence.length && !sparks.length)) {
      continue;
    }
    sections.push({ heading, gist, claims, evidence, sparks });
  }

  if (!summary.length || !sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    summary,
    sections,
  };
}

export function normalizeWorkingNotes(input, fallbackTitle = "") {
  return readWorkingNotesFromUnknown(input, fallbackTitle);
}

function readBookletOutlineFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (let index = 0; index < sectionsRaw.length && index < 8; index += 1) {
    const item = sectionsRaw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const heading = cleanLine(item.heading, 60);
    const goal = cleanLine(item.goal, 120);
    const id = cleanLine(item.id, 40) || `section_${index + 1}`;
    if (!heading) {
      continue;
    }
    sections.push({
      id,
      heading,
      ...(goal ? { goal } : {}),
    });
  }

  if (!sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    sections,
  };
}

function readBookletDraftFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (let index = 0; index < sectionsRaw.length && index < 8; index += 1) {
    const item = sectionsRaw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = cleanLine(item.id, 40) || `section_${index + 1}`;
    const heading = cleanLine(item.heading, 60);
    const body = cleanBodyText(item.body, 4_000);
    if (!heading || !body) {
      continue;
    }
    sections.push({ id, heading, body });
  }

  if (!sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    sections,
  };
}

function normalizeBaseUrl(input) {
  const baseUrl = String(input || DEFAULT_LLM_SETTINGS.llmBaseUrl).trim().replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new Error("模型 Base URL 不是合法网址。");
  }
  if (!SUPPORTED_LLM_HOSTS.has(parsed.hostname)) {
    throw new Error("当前扩展只允许连接 OpenRouter 或 OpenAI 官方接口。若要接别的兼容端点，请先把 host_permissions 加进 manifest。");
  }
  return baseUrl;
}

function normalizeReasoningEffort(input) {
  const normalized = String(input || DEFAULT_LLM_SETTINGS.reasoningEffort).trim().toLowerCase();
  return OPENROUTER_REASONING_EFFORTS.has(normalized) ? normalized : DEFAULT_LLM_SETTINGS.reasoningEffort;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function callJsonChatCompletion(params) {
  const apiKey = String(params.settings?.llmApiKey || "").trim();
  if (!apiKey) {
    throw new Error("请先在模型设置里填写 API key。");
  }

  const baseUrl = normalizeBaseUrl(params.settings?.llmBaseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (baseUrl.includes("openrouter.ai")) {
    Object.assign(headers, OPENROUTER_HEADERS);
  }
  const reasoningEffort = normalizeReasoningEffort(params.settings?.reasoningEffort);
  const requestBody = {
    model: params.settings.llmModel,
    temperature: params.temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: params.systemPrompt,
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
  };
  if (baseUrl.includes("openrouter.ai")) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  try {
    params.pushStage({
      stage: "llm_request",
      config: {
        endpoint,
        model: params.settings.llmModel,
        temperature: params.temperature,
        response_format: "json_object",
        reasoning: baseUrl.includes("openrouter.ai") ? { effort: reasoningEffort } : null,
      },
      input: {
        prompt_preview: params.prompt,
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody),
    });

    const payload = await readJsonResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    params.pushStage({
      stage: "llm_response",
      output: {
        http_status: response.status,
        raw_content_preview: typeof content === "string" ? content : null,
      },
    });

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.error?.code ||
        (typeof content === "string" ? content.slice(0, 300) : "") ||
        `HTTP ${response.status}`;
      throw new Error(`模型请求失败：${message}`);
    }

    const jsonCandidate = typeof content === "string" ? extractFirstJsonObject(content) : null;
    if (!jsonCandidate) {
      throw new Error("模型返回里没有找到可解析的 JSON 对象。");
    }
    return {
      endpoint,
      parsed: JSON.parse(jsonCandidate),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("模型请求超时了，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createStageCollector() {
  const stages = [];
  return {
    stages,
    pushStage(stage) {
      stages.push({
        ...stage,
        ts: new Date().toISOString(),
      });
    },
  };
}

export async function createWorkingNotesFromTranscript(params) {
  if (params.transcriptText.length > LLM_INPUT_MAX_CHARS) {
    throw new Error(`Transcript 太长了。当前上限是 ${LLM_INPUT_MAX_CHARS.toLocaleString()} 个字符。`);
  }

  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("notes");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "transcript",
    input: {
      transcript_chars: params.transcriptText.length,
      source_type: "transcript",
      source_ref: sourceRef ?? null,
      transcript_preview: params.transcriptText,
    },
    config: {
      flow: "transcript_to_working_notes",
      one_pass: true,
      segmentation: "disabled",
      input_cap_chars: LLM_INPUT_MAX_CHARS,
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.wnSystem || DEFAULT_PROMPTS.wnSystem;
  const userTemplate = params.settings.prompts?.wnUser || DEFAULT_PROMPTS.wnUser;

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    transcriptText: params.transcriptText,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.2,
    pushStage,
  });
  const workingNotes = readWorkingNotesFromUnknown(result.parsed, params.title);
  stages[stages.length - 1].output.parse_ok = Boolean(workingNotes);

  if (!workingNotes) {
    throw new Error("模型返回了内容，但没法解析成合格的 Working Notes。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    working_notes: workingNotes,
    stages,
    traceability: {
      source_type: "transcript",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}

export async function createBookletOutlineFromWorkingNotes(params) {
  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("outline");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "normalization",
    input: {
      source_type: "working_notes",
      source_ref: sourceRef ?? null,
      section_count: params.workingNotes.sections.length,
      summary_count: params.workingNotes.summary.length,
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2),
    },
    config: {
      flow: "working_notes_to_booklet_outline",
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.outlineSystem || DEFAULT_PROMPTS.outlineSystem;
  const userTemplate = params.settings.prompts?.outlineUser || DEFAULT_PROMPTS.outlineUser;

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.2,
    pushStage,
  });
  const bookletOutline = readBookletOutlineFromUnknown(result.parsed, params.title);
  stages[stages.length - 1].output.parse_ok = Boolean(bookletOutline);

  if (!bookletOutline) {
    throw new Error("模型返回了内容，但没法解析成合格的 Booklet Outline。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    booklet_outline: bookletOutline,
    stages,
    traceability: {
      source_type: "working_notes",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}

export async function createBookletDraftFromOutline(params) {
  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("draft");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "normalization",
    input: {
      source_type: "booklet_outline",
      source_ref: sourceRef ?? null,
      outline_section_count: params.bookletOutline.sections.length,
      notes_section_count: params.workingNotes.sections.length,
      outline_preview: JSON.stringify(params.bookletOutline, null, 2),
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2),
    },
    config: {
      flow: "booklet_outline_to_booklet_draft",
      one_pass: true,
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.draftSystem || DEFAULT_PROMPTS.draftSystem;
  const userTemplate = params.settings.prompts?.draftUser || DEFAULT_PROMPTS.draftUser;

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
    bookletOutline: params.bookletOutline,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.3,
    pushStage,
  });
  const bookletDraft = readBookletDraftFromUnknown(result.parsed, params.title);
  stages[stages.length - 1].output.parse_ok = Boolean(bookletDraft);

  if (!bookletDraft) {
    throw new Error("模型返回了内容，但没法解析成合格的 Booklet Draft。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    booklet_draft: bookletDraft,
    stages,
    traceability: {
      source_type: "booklet_outline",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}
