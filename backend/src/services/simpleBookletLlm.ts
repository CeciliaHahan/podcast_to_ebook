import { config } from "../config.js";
import type { SourceType } from "../types/domain.js";

type SimpleQuote = {
  speaker: string;
  timestamp: string;
  text: string;
};

type SimpleChapter = {
  title: string;
  summary: string[];
  quotes: SimpleQuote[];
  insights: string[];
  actions: string[];
};

export type SimpleBookletDraft = {
  oneLineConclusion: string;
  tldr: string[];
  chapters: SimpleChapter[];
  terms: Array<{ term: string; definition: string }>;
};

export type SimpleLlmInspectorRequest = {
  endpoint: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  inputMaxChars: number;
  promptPreview: string;
};

export type SimpleLlmInspectorResponse = {
  httpStatus: number;
  rawContentPreview: string;
  parseOk: boolean;
  parsedChapterCount: number;
  parsedTermCount: number;
  parsedTldrCount: number;
};

export type SimpleLlmInspectorHooks = {
  onRequest?: (data: SimpleLlmInspectorRequest) => void;
  onResponse?: (data: SimpleLlmInspectorResponse) => void;
  onError?: (message: string) => void;
};

function cleanText(input: string, maxLength = 220): string {
  return String(input).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function readStringList(value: unknown, maxItems: number, maxLength = 220): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function readQuoteList(value: unknown, maxItems: number): SimpleQuote[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const quotes: SimpleQuote[] = [];
  for (const raw of value.slice(0, maxItems)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const speaker = typeof record.speaker === "string" ? cleanText(record.speaker, 40) : "Speaker";
    const timestamp = typeof record.timestamp === "string" ? cleanText(record.timestamp, 20) : "--:--";
    const text = typeof record.text === "string" ? cleanText(record.text, 220) : "";
    if (!text) {
      continue;
    }
    quotes.push({ speaker: speaker || "Speaker", timestamp: timestamp || "--:--", text });
  }
  return quotes;
}

function extractFirstJsonObject(input: string): string | null {
  const fenced = input.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return input.slice(start, end + 1);
}

function readSimpleDraft(value: unknown): SimpleBookletDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const root = value as Record<string, unknown>;
  const rawOneLineConclusion =
    typeof root.oneLineConclusion === "string"
      ? root.oneLineConclusion
      : typeof root.one_line_conclusion === "string"
        ? root.one_line_conclusion
        : "";
  const oneLineConclusion = cleanText(rawOneLineConclusion, 200);

  const chaptersRaw = Array.isArray(root.chapters) ? root.chapters : [];
  const chapters: SimpleChapter[] = [];
  for (const raw of chaptersRaw.slice(0, 12)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === "string" ? cleanText(record.title, 60) : "";
    const summary = readStringList(record.summary, 5, 180);
    const quotes = readQuoteList(record.quotes, 4);
    const insights = readStringList(record.insights, 4, 180);
    const actions = readStringList(record.actions, 4, 120);
    if (!title && summary.length === 0 && quotes.length === 0 && insights.length === 0 && actions.length === 0) {
      continue;
    }
    chapters.push({
      title,
      summary,
      quotes,
      insights,
      actions,
    });
  }

  const terms = Array.isArray(root.terms)
    ? root.terms
        .map((raw) => {
          if (!raw || typeof raw !== "object") {
            return null;
          }
          const record = raw as Record<string, unknown>;
          const term = typeof record.term === "string" ? cleanText(record.term, 40) : "";
          const definition = typeof record.definition === "string" ? cleanText(record.definition, 140) : "";
          if (!term || !definition) {
            return null;
          }
          return { term, definition };
        })
        .filter((item): item is { term: string; definition: string } => Boolean(item))
        .slice(0, 8)
    : [];

  const tldr = readStringList(root.tldr, 8, 200);
  if (!oneLineConclusion && tldr.length === 0 && chapters.length === 0) {
    return null;
  }

  return {
    oneLineConclusion,
    tldr,
    chapters,
    terms,
  };
}

function buildPrompt(params: {
  title: string;
  language: string;
  sourceType: SourceType;
  sourceRef: string;
  transcriptText: string;
  chapterTarget: number;
  segmentLabel?: string;
}): string {
  return [
    "任务：把 transcript 整理成一个简洁、可直接渲染为电子书的 JSON。",
    "目标：减少花哨包装，优先保留真实观点、关键引用、清晰章节和可执行动作。",
    "硬性要求：",
    "1) 只输出一个合法 JSON 对象。",
    "2) 不要编造事实、引用、说话人、时间戳。",
    "3) 无法确认时请保守表达，不要强行补全。",
    "4) 章节标题要具体，避免空洞词、口头禅、碎片词。",
    "5) actions 必须来自内容本身，不能写模板化动作。",
    "6) 尽量让全书读起来像一本清晰的短书，而不是 prompt 痕迹很重的表格。",
    "JSON schema:",
    `{
  "one_line_conclusion": "string",
  "tldr": ["string"],
  "chapters": [
    {
      "title": "string",
      "summary": ["string"],
      "quotes": [
        {"speaker": "string", "timestamp": "string", "text": "string"}
      ],
      "insights": ["string"],
      "actions": ["string"]
    }
  ],
  "terms": [
    {"term": "string", "definition": "string"}
  ]
}`,
    `章节目标数：${params.chapterTarget}`,
    params.segmentLabel ? `当前仅处理片段：${params.segmentLabel}` : "当前处理整份 transcript。",
    `title=${params.title}`,
    `language=${params.language}`,
    `source_type=${params.sourceType}`,
    `source_ref=${params.sourceRef}`,
    "下面是 transcript：",
    params.transcriptText,
  ].join("\n");
}

export async function generateSimpleBookletDraftWithLlm(params: {
  title: string;
  language: string;
  sourceType: SourceType;
  sourceRef: string;
  transcriptText: string;
  chapterTarget: number;
  segmentLabel?: string;
  inspector?: SimpleLlmInspectorHooks;
}): Promise<SimpleBookletDraft | null> {
  if (!config.llmApiKey) {
    params.inspector?.onError?.("Missing LLM API key.");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    const transcriptText = params.transcriptText.slice(0, config.llmInputMaxChars);
    const prompt = buildPrompt({
      ...params,
      transcriptText,
    });

    const body = {
      model: config.llmModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是中文播客内容编辑。请把 transcript 整理成简洁、可信、结构稳定的电子书中间 JSON。不要输出任何 JSON 之外的文字。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const endpoint = `${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
    params.inspector?.onRequest?.({
      endpoint,
      model: config.llmModel,
      temperature: body.temperature,
      timeoutMs: config.llmTimeoutMs,
      inputMaxChars: config.llmInputMaxChars,
      promptPreview: prompt.slice(0, 5000),
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      params.inspector?.onError?.(`LLM HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      params.inspector?.onError?.("LLM response contained no content.");
      return null;
    }

    const jsonCandidate = extractFirstJsonObject(content);
    if (!jsonCandidate) {
      params.inspector?.onResponse?.({
        httpStatus: response.status,
        rawContentPreview: content.slice(0, 5000),
        parseOk: false,
        parsedChapterCount: 0,
        parsedTermCount: 0,
        parsedTldrCount: 0,
      });
      return null;
    }

    const parsed = JSON.parse(jsonCandidate) as unknown;
    const draft = readSimpleDraft(parsed);
    params.inspector?.onResponse?.({
      httpStatus: response.status,
      rawContentPreview: content.slice(0, 5000),
      parseOk: Boolean(draft),
      parsedChapterCount: draft?.chapters.length ?? 0,
      parsedTermCount: draft?.terms.length ?? 0,
      parsedTldrCount: draft?.tldr.length ?? 0,
    });
    return draft;
  } catch (error) {
    params.inspector?.onError?.(error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
