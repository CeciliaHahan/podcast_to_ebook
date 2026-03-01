import { config } from "../config.js";
import type { SourceType } from "../types/domain.js";

const SYSTEM_PROMPT = [
  "You are an editorial assistant that converts a podcast transcript into a high-quality Chinese knowledge booklet draft.",
  "Your priorities, in order: (1) faithfulness to transcript, (2) clarity and structure, (3) actionable takeaways.",
  "Return valid JSON only. No markdown, no commentary, no extra keys.",
  "Never invent facts, quotes, timestamps, or speakers.",
  'If transcript evidence is insufficient, use the literal phrase: "未在原文中明确说明".',
  "Quotes must remain faithful to transcript wording; do not paraphrase inside quote text.",
  "Use clear modern Chinese, avoid influencer tone, and avoid unnecessary English.",
].join(" ");

type LlmBookletQuote = {
  speaker: string;
  timestamp: string;
  text: string;
};

type LlmChapterExplanation = {
  background: string;
  coreConcept: string;
  judgmentFramework: string;
  commonMisunderstanding: string;
};

type LlmBookletChapter = {
  title: string;
  points: string[];
  quotes: LlmBookletQuote[];
  explanation: LlmChapterExplanation;
  actions: string[];
};

type LlmChapterPlanHint = {
  chapterIndex: number;
  title: string;
  range: string;
  segmentIds: string[];
  intent: string;
  signals: string[];
  contextExcerpt: string;
  evidenceAnchors: LlmBookletQuote[];
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

export type LlmInspectorRequest = {
  endpoint: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  inputMaxChars: number;
  promptPreview: string;
};

export type LlmInspectorResponse = {
  httpStatus: number;
  rawContentPreview: string;
  parseOk: boolean;
  parsedChapterCount: number;
  parsedTermCount: number;
  parsedTldrCount: number;
};

export type LlmInspectorHooks = {
  onRequest?: (data: LlmInspectorRequest) => void;
  onResponse?: (data: LlmInspectorResponse) => void;
  onError?: (message: string) => void;
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

function readChapterExplanation(value: unknown): LlmChapterExplanation {
  if (!value || typeof value !== "object") {
    return {
      background: "",
      coreConcept: "",
      judgmentFramework: "",
      commonMisunderstanding: "",
    };
  }
  const record = value as Record<string, unknown>;
  return {
    background: typeof record.background === "string" ? cleanText(record.background, 220) : "",
    coreConcept: typeof record.coreConcept === "string" ? cleanText(record.coreConcept, 220) : "",
    judgmentFramework:
      typeof record.judgmentFramework === "string" ? cleanText(record.judgmentFramework, 220) : "",
    commonMisunderstanding:
      typeof record.commonMisunderstanding === "string" ? cleanText(record.commonMisunderstanding, 220) : "",
  };
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
    const explanation = readChapterExplanation(chapter.explanation);
    const actions = readStringList(chapter.actions, 4, 120);
    if (
      !title &&
      points.length === 0 &&
      quotes.length === 0 &&
      actions.length === 0 &&
      !explanation.background &&
      !explanation.coreConcept &&
      !explanation.judgmentFramework &&
      !explanation.commonMisunderstanding
    ) {
      continue;
    }
    chapters.push({
      title,
      points,
      quotes,
      explanation,
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
  chapterPlans: LlmChapterPlanHint[];
  transcriptText: string;
}): string {
  const chapterHint = params.chapterRanges.map((range, index) => `- chapter ${index + 1}: ${range}`).join("\n");
  const chapterPlanHint = params.chapterPlans
    .map((plan) => {
      const anchors = plan.evidenceAnchors
        .map((quote) => `    - [${quote.timestamp}] ${quote.speaker}: ${quote.text}`)
        .join("\n");
      return [
        `- chapter ${plan.chapterIndex}`,
        `  - title: ${plan.title}`,
        `  - range: ${plan.range}`,
        `  - intent: ${plan.intent}`,
        `  - segment_ids: ${plan.segmentIds.join(", ") || "-"}`,
        `  - signals: ${plan.signals.join(", ") || "-"}`,
        `  - context_excerpt: ${plan.contextExcerpt}`,
        "  - evidence_anchors:",
        anchors || "    - 未在原文中明确说明",
      ].join("\n");
    })
    .join("\n");
  return [
    "任务：将播客转写整理成“知识小册子”结构化草稿（JSON）。",
    "硬性要求：",
    "1) 绝不虚构事实、观点、时间戳、说话人、引文。",
    '2) 无法确认的判断请写“未在原文中明确说明”。',
    "3) quote.text 必须是原文忠实片段（可轻微去口水词，不改变含义）。",
    "4) 输出中文，具体可执行，避免空泛口号。",
    "5) 仅输出一个 JSON 对象，不要输出其他内容。",
    "6) `chapters` 数量和顺序必须与 chapter_plan 完全一致，不得增删章节或重排。",
    "7) 每章内容仅使用该章对应的 context/evidence；禁止跨章挪用引文。",
    "JSON 字段契约（必须使用以下键名）：",
    `{
  "suitableFor": string[3-5],
  "outcomes": string[3-5],
  "oneLineConclusion": string,
  "tldr": string[5-7],
  "chapters": [
    {
      "title": string,
      "points": string[3-5],
      "quotes": [{"speaker": string, "timestamp": string, "text": string}, {"speaker": string, "timestamp": string, "text": string}, "... 2-4 total"],
      "explanation": {
        "background": string,
        "coreConcept": string,
        "judgmentFramework": string,
        "commonMisunderstanding": string
      },
      "actions": string[2-4]
    }
  ],
  "actionNow": string[2-3],
  "actionWeek": string[2-3],
  "actionLong": string[1-2],
  "terms": [{"term": string, "definition": string}, "... 3-6 total"],
  "appendixThemes": [
    {"name": string, "quotes": [{"speaker": string, "timestamp": string, "text": string}, "... 2-6 total"]},
    {"name": string, "quotes": [{"speaker": string, "timestamp": string, "text": string}, "... 2-6 total"]}
  ]
}`,
    "章节质量要求：",
    "- 每章 points 要具体，避免抽象套话。",
    "- 每章至少 2 条 quotes，优先保留有信息密度的原文句子。",
    "- 每章 explanation 需要可读、保守，不可脱离原文编造成因。",
    "- 每章 actions 用动词开头，必须能执行。",
    "- chapter[i].title 应与 chapter_plan[i] 对齐，可轻微润色但不得偏离主题。",
    "全局质检（生成前自查）：",
    "- TL;DR 每条都能在 transcript 中找到依据。",
    "- 引用里的时间戳与说话人尽量与原文一致。",
    "- 若 transcript 存在噪音/乱码，避免把噪音作为关键引用。",
    `上下文元信息:
- title: ${params.title}
- language: ${params.language}
- source_type: ${params.sourceType}
- source_ref: ${params.sourceRef}
- chapter range hints:
${chapterHint}
- chapter_plan:
${chapterPlanHint}`,
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
  chapterPlans: LlmChapterPlanHint[];
  transcriptText: string;
  inspector?: LlmInspectorHooks;
}): Promise<LlmBookletDraft | null> {
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
          content: SYSTEM_PROMPT,
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
    const draft = readDraftFromUnknown(parsed);
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
    const errorMessage = error instanceof Error ? error.message : "Unknown LLM exception";
    params.inspector?.onError?.(errorMessage);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
