export const DEFAULT_LLM_SETTINGS = {
  llmBaseUrl: "https://openrouter.ai/api/v1",
  llmModel: "google/gemini-3-flash-preview",
  llmApiKey: "",
};

export const LLM_INPUT_MAX_CHARS = 80_000;
const LLM_TIMEOUT_MS = 90_000;
const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://chrome-extension.local/podcasts-to-ebooks",
  "X-Title": "Podcasts to Ebooks",
};
const SUPPORTED_LLM_HOSTS = new Set(["openrouter.ai", "api.openai.com"]);

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
    const bullets = readStringList(item.bullets, 5, 180);
    const excerpts = readStringList(item.excerpts, 3, 220);
    if (!heading || !bullets.length || !excerpts.length) {
      continue;
    }
    sections.push({ heading, bullets, excerpts });
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

function buildWorkingNotesPrompt(params) {
  return [
    "任务：把 transcript 转成用于后续生成 booklet 的 working notes。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "working notes 只服务于下一步 outline，不是最终 ebook。",
    "严格要求：",
    "1) 只能使用 transcript 本身，不得使用外部知识。",
    "2) summary 写 3-7 条，尽量具体，不要空话。",
    "3) sections 写 3-6 段，每段包含 heading、bullets、excerpts。",
    "4) excerpts 必须是 transcript 里的短摘录，尽量保留原话，不要改写成总结句。",
    "5) 不要发明时间戳、speaker、theme id、claim id、utterance id。",
    "6) 不要做分段策略设计；把这次输入当成单次 one-pass transcript 处理。",
    "JSON schema:",
    `{
  "title": string,
  "summary": string[],
  "sections": [
    {
      "heading": string,
      "bullets": string[],
      "excerpts": string[]
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "transcript:",
    params.transcriptText,
  ].join("\n");
}

function buildOutlinePrompt(params) {
  return [
    "任务：把 working notes 转成 booklet outline。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "目标：先产出一个可检查的章节顺序，不写最终正文。",
    "严格要求：",
    "1) 只能使用传入的 working notes，不得使用外部知识。",
    "2) sections 保持 3-6 段，顺序要尽量自然。",
    "3) 每段必须有 id 和 heading，可以有 goal。",
    "4) goal 要说清楚这一段想帮助读者理解什么，但不要写成长段正文。",
    "5) 不要发明 quotes、actions、memory、segmentation 之类额外结构。",
    "JSON schema:",
    `{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "goal": string
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "working notes:",
    JSON.stringify(params.workingNotes, null, 2),
  ].join("\n");
}

function buildDraftPrompt(params) {
  return [
    "任务：把 booklet outline 写成一个可阅读的 booklet draft。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "目标：先产出一版可读正文，后面再决定是否继续润色。",
    "严格要求：",
    "1) 只能使用传入的 working notes 和 booklet outline，不得使用外部知识。",
    "2) sections 顺序必须和 outline 一致。",
    "3) 每段必须保留 outline 里的 id 和 heading。",
    "4) body 写成自然、清楚、简洁的正文，不要写成要点列表。",
    "5) body 尽量用 working notes 里的 bullets 和 excerpts 作为依据，不要发明新事实。",
    "6) 不要发明 quotes、actions、memory、theme id、support refs 之类额外结构。",
    "JSON schema:",
    `{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "body": string
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "working notes:",
    JSON.stringify(params.workingNotes, null, 2),
    "booklet outline:",
    JSON.stringify(params.bookletOutline, null, 2),
  ].join("\n");
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

  try {
    params.pushStage({
      stage: "llm_request",
      config: {
        endpoint,
        model: params.settings.llmModel,
        temperature: params.temperature,
        response_format: "json_object",
      },
      input: {
        prompt_preview: params.prompt.slice(0, 5_000),
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
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
      }),
    });

    const payload = await readJsonResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    params.pushStage({
      stage: "llm_response",
      output: {
        http_status: response.status,
        raw_content_preview: typeof content === "string" ? content.slice(0, 3_000) : null,
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
      transcript_preview: params.transcriptText.slice(0, 2_500),
    },
    config: {
      flow: "transcript_to_working_notes",
      one_pass: true,
      segmentation: "disabled",
      input_cap_chars: LLM_INPUT_MAX_CHARS,
      execution_mode: "extension_local",
    },
  });

  const prompt = buildWorkingNotesPrompt({
    title: params.title,
    language: params.language,
    transcriptText: params.transcriptText,
  });
  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt:
      "你是 transcript working-notes 生成器。你的任务是把 transcript 压缩成 summary + sections + excerpts 的 JSON，供后续 outline 使用。不得输出 schema 之外的内容。",
    temperature: 0.2,
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
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2).slice(0, 2_500),
    },
    config: {
      flow: "working_notes_to_booklet_outline",
      execution_mode: "extension_local",
    },
  });

  const prompt = buildOutlinePrompt({
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
  });
  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt: "你是 booklet outline 生成器。你的任务是把 working notes 转成 title + ordered sections 的 JSON。不得输出 schema 之外的内容。",
    temperature: 0.2,
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
      outline_preview: JSON.stringify(params.bookletOutline, null, 2).slice(0, 2_500),
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2).slice(0, 2_500),
    },
    config: {
      flow: "booklet_outline_to_booklet_draft",
      one_pass: true,
      execution_mode: "extension_local",
    },
  });

  const prompt = buildDraftPrompt({
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
    bookletOutline: params.bookletOutline,
  });
  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt:
      "你是 booklet draft 生成器。你的任务是把 working notes 和 booklet outline 写成 title + sections(body) 的 JSON。不得输出 schema 之外的内容。",
    temperature: 0.3,
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
