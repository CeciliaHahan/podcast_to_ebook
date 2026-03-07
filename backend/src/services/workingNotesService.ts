import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { createId } from "../lib/ids.js";
import type { InspectorPushInput, InspectorStageRecord } from "../repositories/jobsRepo.js";

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

function extractFirstJsonObject(input: string): string | null {
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

function cleanLine(input: unknown, maxLength = 180): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function readStringList(input: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const output: string[] = [];
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

function readWorkingNotesFromUnknown(input: unknown, fallbackTitle: string): WorkingNotes | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input as Record<string, unknown>;
  const summary = readStringList(root.summary, 7, 180);
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections: WorkingNotes["sections"] = [];

  for (const item of sectionsRaw.slice(0, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const heading = cleanLine(record.heading, 60);
    const bullets = readStringList(record.bullets, 5, 180);
    const excerpts = readStringList(record.excerpts, 3, 220);
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

function readBookletOutlineFromUnknown(input: unknown, fallbackTitle: string): BookletOutline | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input as Record<string, unknown>;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections: BookletOutline["sections"] = [];

  for (let index = 0; index < sectionsRaw.length && index < 8; index += 1) {
    const item = sectionsRaw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const heading = cleanLine(record.heading, 60);
    const goal = cleanLine(record.goal, 120);
    const id = cleanLine(record.id, 40) || `section_${index + 1}`;
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

function buildPrompt(params: { title: string; language: string; transcriptText: string }) {
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

function buildOutlinePrompt(params: { title: string; language: string; workingNotes: WorkingNotes }) {
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

export async function createWorkingNotesFromTranscript(params: {
  title: string;
  language: string;
  transcriptText: string;
  metadata?: Record<string, unknown>;
}) {
  if (!config.llmApiKey) {
    throw new ApiError(503, "LLM_UNAVAILABLE", "LLM API key is not configured.");
  }
  if (params.transcriptText.length > config.llmInputMaxChars) {
    throw new ApiError(
      400,
      "TRANSCRIPT_TOO_LARGE",
      `Transcript exceeds one-pass cap of ${config.llmInputMaxChars} characters for working notes.`,
    );
  }

  const jobId = createId("notes");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;
  const stages: InspectorStageRecord[] = [];
  const pushStage = (stage: InspectorPushInput) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };

  pushStage({
    stage: "transcript",
    input: {
      transcript_chars: params.transcriptText.length,
      source_type: "transcript",
      source_ref: sourceRef ?? null,
      transcript_preview: params.transcriptText.slice(0, 2500),
    },
    config: {
      flow: "transcript_to_working_notes",
      one_pass: true,
      segmentation: "disabled",
      input_cap_chars: config.llmInputMaxChars,
    },
  });

  const prompt = buildPrompt({
    title: params.title,
    language: params.language,
    transcriptText: params.transcriptText,
  });
  const endpoint = `${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    pushStage({
      stage: "llm_request",
      config: {
        endpoint,
        model: config.llmModel,
        temperature: 0.2,
        response_format: "json_object",
      },
      input: {
        prompt_preview: prompt.slice(0, 5000),
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 transcript working-notes 生成器。你的任务是把 transcript 压缩成 summary + sections + excerpts 的 JSON，供后续 outline 使用。不得输出 schema 之外的内容。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const jsonCandidate = typeof content === "string" ? extractFirstJsonObject(content) : null;
    const parsed = jsonCandidate ? JSON.parse(jsonCandidate) : null;
    const workingNotes = readWorkingNotesFromUnknown(parsed, params.title);

    pushStage({
      stage: "llm_response",
      output: {
        http_status: response.status,
        parse_ok: Boolean(workingNotes),
        raw_content_preview: typeof content === "string" ? content.slice(0, 3000) : null,
      },
    });

    if (!response.ok) {
      throw new ApiError(502, "LLM_HTTP_ERROR", `Working notes generation failed with HTTP ${response.status}.`);
    }
    if (!workingNotes) {
      throw new ApiError(502, "WORKING_NOTES_PARSE_FAILED", "Failed to parse working notes response.");
    }

    return {
      job_id: jobId,
      status: "succeeded" as const,
      created_at: createdAt,
      working_notes: workingNotes,
      stages,
      traceability: {
        source_type: "transcript" as const,
        source_ref: sourceRef ?? "internal://source-ref",
        generated_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown working notes error";
    throw new ApiError(502, "WORKING_NOTES_FAILED", message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createBookletOutlineFromWorkingNotes(params: {
  title: string;
  language: string;
  workingNotes: WorkingNotes;
  metadata?: Record<string, unknown>;
}) {
  if (!config.llmApiKey) {
    throw new ApiError(503, "LLM_UNAVAILABLE", "LLM API key is not configured.");
  }

  const jobId = createId("outline");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;
  const stages: InspectorStageRecord[] = [];
  const pushStage = (stage: InspectorPushInput) => {
    stages.push({
      ...stage,
      ts: new Date().toISOString(),
    });
  };

  pushStage({
    stage: "normalization",
    input: {
      source_type: "working_notes",
      source_ref: sourceRef ?? null,
      section_count: params.workingNotes.sections.length,
      summary_count: params.workingNotes.summary.length,
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2).slice(0, 2500),
    },
    config: {
      flow: "working_notes_to_booklet_outline",
    },
  });

  const prompt = buildOutlinePrompt({
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
  });
  const endpoint = `${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    pushStage({
      stage: "llm_request",
      config: {
        endpoint,
        model: config.llmModel,
        temperature: 0.2,
        response_format: "json_object",
      },
      input: {
        prompt_preview: prompt.slice(0, 5000),
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 booklet outline 生成器。你的任务是把 working notes 转成 title + ordered sections 的 JSON。不得输出 schema 之外的内容。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const jsonCandidate = typeof content === "string" ? extractFirstJsonObject(content) : null;
    const parsed = jsonCandidate ? JSON.parse(jsonCandidate) : null;
    const bookletOutline = readBookletOutlineFromUnknown(parsed, params.title);

    pushStage({
      stage: "llm_response",
      output: {
        http_status: response.status,
        parse_ok: Boolean(bookletOutline),
        raw_content_preview: typeof content === "string" ? content.slice(0, 3000) : null,
      },
    });

    if (!response.ok) {
      throw new ApiError(502, "LLM_HTTP_ERROR", `Booklet outline generation failed with HTTP ${response.status}.`);
    }
    if (!bookletOutline) {
      throw new ApiError(502, "BOOKLET_OUTLINE_PARSE_FAILED", "Failed to parse booklet outline response.");
    }

    return {
      job_id: jobId,
      status: "succeeded" as const,
      created_at: createdAt,
      booklet_outline: bookletOutline,
      stages,
      traceability: {
        source_type: "working_notes" as const,
        source_ref: sourceRef ?? "internal://source-ref",
        generated_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown booklet outline error";
    throw new ApiError(502, "BOOKLET_OUTLINE_FAILED", message);
  } finally {
    clearTimeout(timeout);
  }
}
