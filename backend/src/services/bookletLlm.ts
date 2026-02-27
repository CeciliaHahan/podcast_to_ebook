import { config } from "../config.js";
import type { SourceType } from "../types/domain.js";

type LlmBookletQuote = {
  speaker: string;
  timestamp: string;
  text: string;
};

type LlmBookletChapter = {
  title: string;
  points: string[];
  quotes: LlmBookletQuote[];
  actions: string[];
};

export type LlmBookletDraft = {
  suitableFor: string[];
  outcomes: string[];
  oneLineConclusion: string;
  tldr: string[];
  chapters: LlmBookletChapter[];
  actionNow: string[];
  actionWeek: string[];
  actionLong: string[];
  terms: Array<{ term: string; definition: string }>;
  appendixThemes: Array<{ name: string; quotes: LlmBookletQuote[] }>;
};

function cleanText(input: string, maxLength = 220): string {
  return input
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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

function readQuoteList(value: unknown, maxItems: number): LlmBookletQuote[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const quotes: LlmBookletQuote[] = [];
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

function readDraftFromUnknown(value: unknown): LlmBookletDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const root = value as Record<string, unknown>;
  const oneLineConclusion = typeof root.oneLineConclusion === "string" ? cleanText(root.oneLineConclusion, 200) : "";
  const chaptersRaw = Array.isArray(root.chapters) ? root.chapters : [];
  const chapters: LlmBookletChapter[] = [];
  for (const item of chaptersRaw.slice(0, 7)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const chapter = item as Record<string, unknown>;
    const title = typeof chapter.title === "string" ? cleanText(chapter.title, 40) : "";
    const points = readStringList(chapter.points, 5, 180);
    const quotes = readQuoteList(chapter.quotes, 4);
    const actions = readStringList(chapter.actions, 4, 120);
    if (!title && points.length === 0 && quotes.length === 0 && actions.length === 0) {
      continue;
    }
    chapters.push({
      title,
      points,
      quotes,
      actions,
    });
  }

  const terms = Array.isArray(root.terms)
    ? root.terms
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const record = item as Record<string, unknown>;
          const term = typeof record.term === "string" ? cleanText(record.term, 30) : "";
          const definition = typeof record.definition === "string" ? cleanText(record.definition, 120) : "";
          if (!term || !definition) {
            return null;
          }
          return { term, definition };
        })
        .filter((item): item is { term: string; definition: string } => Boolean(item))
        .slice(0, 8)
    : [];

  const appendixThemes = Array.isArray(root.appendixThemes)
    ? root.appendixThemes
        .map((themeRaw) => {
          if (!themeRaw || typeof themeRaw !== "object") {
            return null;
          }
          const theme = themeRaw as Record<string, unknown>;
          const name = typeof theme.name === "string" ? cleanText(theme.name, 40) : "";
          const quotes = readQuoteList(theme.quotes, 6);
          if (!name || !quotes.length) {
            return null;
          }
          return { name, quotes };
        })
        .filter((item): item is { name: string; quotes: LlmBookletQuote[] } => Boolean(item))
        .slice(0, 4)
    : [];

  return {
    suitableFor: readStringList(root.suitableFor, 5, 120),
    outcomes: readStringList(root.outcomes, 5, 120),
    oneLineConclusion,
    tldr: readStringList(root.tldr, 10, 200),
    chapters,
    actionNow: readStringList(root.actionNow, 8, 120),
    actionWeek: readStringList(root.actionWeek, 8, 120),
    actionLong: readStringList(root.actionLong, 8, 120),
    terms,
    appendixThemes,
  };
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

function buildPrompt(params: {
  title: string;
  language: string;
  sourceType: SourceType;
  sourceRef: string;
  chapterRanges: string[];
  transcriptText: string;
}): string {
  const chapterHint = params.chapterRanges.map((range, index) => `- chapter ${index + 1}: ${range}`).join("\n");
  return [
    "请你扮演中文非虚构图书编辑，把播客转写整理成“可读的小册子结构”。",
    "输出必须是 JSON，不要输出 Markdown，不要解释。",
    "语言默认中文，保持原意，不编造事实；引用尽量使用原文中的时间戳。",
    "JSON 字段要求：",
    `{
  "suitableFor": string[3],
  "outcomes": string[3],
  "oneLineConclusion": string,
  "tldr": string[7],
  "chapters": [
    {
      "title": string,
      "points": string[3],
      "quotes": [{"speaker": string, "timestamp": string, "text": string}, {"speaker": string, "timestamp": string, "text": string}],
      "actions": string[2]
    }
  ],
  "actionNow": string[2],
  "actionWeek": string[2],
  "actionLong": string[2],
  "terms": [{"term": string, "definition": string}, {"term": string, "definition": string}, {"term": string, "definition": string}],
  "appendixThemes": [
    {"name": string, "quotes": [{"speaker": string, "timestamp": string, "text": string}, {"speaker": string, "timestamp": string, "text": string}]},
    {"name": string, "quotes": [{"speaker": string, "timestamp": string, "text": string}, {"speaker": string, "timestamp": string, "text": string}]}
  ]
}`,
    `上下文元信息:
- title: ${params.title}
- language: ${params.language}
- source_type: ${params.sourceType}
- source_ref: ${params.sourceRef}
- chapter range hints:
${chapterHint}`,
    "下面是原始 transcript（可能包含口头语和噪音）：",
    params.transcriptText,
  ].join("\n");
}

export async function generateBookletDraftWithLlm(params: {
  title: string;
  language: string;
  sourceType: SourceType;
  sourceRef: string;
  chapterRanges: string[];
  transcriptText: string;
}): Promise<LlmBookletDraft | null> {
  if (!config.llmApiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  try {
    const transcriptText = params.transcriptText.slice(0, config.llmInputMaxChars);
    const body = {
      model: config.llmModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise Chinese non-fiction editor. Return valid JSON only. Keep outputs concise, specific, and grounded in transcript.",
        },
        {
          role: "user",
          content: buildPrompt({
            ...params,
            transcriptText,
          }),
        },
      ],
    };

    const response = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }

    const jsonCandidate = extractFirstJsonObject(content);
    if (!jsonCandidate) {
      return null;
    }

    const parsed = JSON.parse(jsonCandidate) as unknown;
    return readDraftFromUnknown(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

