import type { PoolClient } from "pg";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { db } from "../db/pool.js";
import { createId } from "../lib/ids.js";
import type { CreateJobInput, JobStatus, OutputFormat, SourceType } from "../types/domain.js";
import { config } from "../config.js";
import { generateBookletDraftWithLlm } from "../services/bookletLlm.js";

const execFileAsync = promisify(execFile);

export type JobRecord = {
  id: string;
  userId: string;
  sourceType: SourceType;
  status: JobStatus;
  progress: number;
  stage: string;
  title: string | null;
  language: string | null;
  templateId: string;
  outputFormats: OutputFormat[];
  sourceRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactRecord = {
  type: OutputFormat;
  fileName: string;
  sizeBytes: number;
  downloadUrl: string;
  expiresAt: string;
};

export type JobInputRecord = {
  metadata: Record<string, unknown>;
  episodeUrl: string | null;
  rssUrl: string | null;
};

export type ArtifactDownloadRecord = {
  fileName: string;
  storageUri: string;
  expiresAt: string | null;
  type: OutputFormat;
};

export type InspectorStageName =
  | "transcript"
  | "llm_request"
  | "llm_response"
  | "normalization"
  | "pdf";

export type InspectorStageRecord = {
  stage: InspectorStageName;
  ts: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  config?: Record<string, unknown>;
  notes?: string;
};

export type InspectorPushInput = Omit<InspectorStageRecord, "ts">;

const CJK_FONT_CANDIDATES = [
  path.resolve(process.cwd(), "../assets/fonts/NotoSansCJKsc-Regular.otf"),
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
];

function pushInspectorStage(
  collector: ((stage: InspectorPushInput) => void) | undefined,
  stage: InspectorPushInput,
) {
  if (!collector) {
    return;
  }
  collector(stage);
}

export async function countActiveJobs(userId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM jobs
      WHERE user_id = $1 AND status IN ('queued', 'processing')`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function countDailyJobs(userId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM jobs
      WHERE user_id = $1
        AND created_at::date = CURRENT_DATE`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function failStaleActiveJobs(userId: string, staleMinutes: number): Promise<number> {
  const result = await db.query(
    `UPDATE jobs
        SET status = 'failed'::job_status,
            error_code = 'STALE_ACTIVE_JOB_RECOVERED',
            error_message = 'Auto-marked failed after stale active timeout.',
            finished_at = CASE WHEN finished_at IS NULL THEN NOW() ELSE finished_at END,
            updated_at = NOW()
      WHERE user_id = $1
        AND status IN ('queued'::job_status, 'processing'::job_status)
        AND updated_at < NOW() - ($2::int * INTERVAL '1 minute')`,
    [userId, staleMinutes],
  );
  return result.rowCount ?? 0;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createJob(input: CreateJobInput): Promise<{ jobId: string; status: JobStatus; createdAt: string }> {
  return withTransaction(async (client) => {
    if (input.idempotencyKey) {
      const existing = await client.query<{ id: string; status: JobStatus; created_at: string }>(
        `SELECT id, status, created_at
           FROM jobs
          WHERE user_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [input.userId, input.idempotencyKey],
      );
      const hit = existing.rows[0];
      if (hit) {
        return {
          jobId: hit.id,
          status: hit.status,
          createdAt: hit.created_at,
        };
      }
    }

    const complianceId = createId("cmp");
    await client.query(
      `INSERT INTO compliance_records
         (id, user_id, for_personal_or_authorized_use_only, no_commercial_use, acceptance_copy, request_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        complianceId,
        input.userId,
        input.compliance.forPersonalOrAuthorizedUseOnly,
        input.compliance.noCommercialUse,
        input.acceptanceCopy,
        input.requestIp ?? null,
        input.userAgent ?? null,
      ],
    );

    const jobId = createId("job");
    const insertJob = await client.query<{ created_at: string }>(
      `INSERT INTO jobs
         (id, user_id, source_type, status, progress, stage, title, language, template_id,
          output_formats, source_ref, input_char_count, input_duration_seconds, idempotency_key,
          compliance_record_id)
       VALUES
         ($1, $2, $3, 'queued', 0, 'queued', $4, $5, $6,
          $7::jsonb, $8, $9, $10, $11, $12)
       RETURNING created_at`,
      [
        jobId,
        input.userId,
        input.sourceType,
        input.title ?? null,
        input.language ?? null,
        input.templateId,
        JSON.stringify(input.outputFormats),
        input.sourceRef ?? null,
        input.inputCharCount ?? null,
        input.inputDurationSeconds ?? null,
        input.idempotencyKey ?? null,
        complianceId,
      ],
    );

    await client.query(
      `INSERT INTO job_inputs
         (id, job_id, transcript_storage_uri, audio_storage_uri, rss_url, rss_episode_id, episode_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        createId("inp"),
        jobId,
        input.rawInput.transcriptStorageUri ?? null,
        input.rawInput.audioStorageUri ?? null,
        input.rawInput.rssUrl ?? null,
        input.rawInput.rssEpisodeId ?? null,
        input.rawInput.episodeUrl ?? null,
        JSON.stringify(input.rawInput.metadata ?? {}),
      ],
    );

    return {
      jobId,
      status: "queued",
      createdAt: insertJob.rows[0].created_at,
    };
  });
}

function mapJobRow(row: any): JobRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type as SourceType,
    status: row.status as JobStatus,
    progress: row.progress,
    stage: row.stage,
    title: row.title,
    language: row.language,
    templateId: row.template_id,
    outputFormats: row.output_formats as OutputFormat[],
    sourceRef: row.source_ref,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getJobById(jobId: string, userId: string): Promise<JobRecord | null> {
  const result = await db.query(
    `SELECT id, user_id, source_type, status, progress, stage, title, language, template_id, source_ref,
            output_formats, error_code, error_message, created_at, updated_at
       FROM jobs
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [jobId, userId],
  );
  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  return mapJobRow(result.rows[0]);
}

export async function getJobByIdAny(jobId: string): Promise<JobRecord | null> {
  const result = await db.query(
    `SELECT id, user_id, source_type, status, progress, stage, title, language, template_id, source_ref,
            output_formats, error_code, error_message, created_at, updated_at
       FROM jobs
      WHERE id = $1
      LIMIT 1`,
    [jobId],
  );
  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  return mapJobRow(result.rows[0]);
}

export async function updateJobStatusAndStage(params: {
  jobId: string;
  status: JobStatus;
  stage: string;
  progress: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  await db.query(
    `UPDATE jobs
        SET status = $2::job_status,
            stage = $3,
            progress = $4,
            error_code = $5,
            error_message = $6,
            started_at = CASE WHEN $2::job_status = 'processing'::job_status AND started_at IS NULL THEN NOW() ELSE started_at END,
            finished_at = CASE WHEN $2::job_status IN ('succeeded'::job_status, 'failed'::job_status, 'canceled'::job_status) THEN NOW() ELSE finished_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      params.jobId,
      params.status,
      params.stage,
      params.progress,
      params.errorCode ?? null,
      params.errorMessage ?? null,
    ],
  );
}

type TranscriptEntry = {
  speaker: string;
  timestamp: string;
  text: string;
};

type BookletQuote = {
  speaker: string;
  timestamp: string;
  text: string;
};

type BookletChapterExplanation = {
  background: string;
  coreConcept: string;
  judgmentFramework: string;
  commonMisunderstanding: string;
};

type BookletChapter = {
  index: number;
  sectionId: string;
  title: string;
  range: string;
  points: string[];
  quotes: BookletQuote[];
  explanation: BookletChapterExplanation;
  actions: string[];
};

type BookletTerm = {
  term: string;
  definition: string;
};

type BookletModel = {
  meta: {
    identifier: string;
    title: string;
    language: string;
    dcLanguage: string;
    creator: string;
    generatedAtIso: string;
    generatedDate: string;
    sourceRef: string;
    sourceType: string;
    templateId: string;
  };
  suitableFor: string[];
  outcomes: string[];
  oneLineConclusion: string;
  tldr: string[];
  chapters: BookletChapter[];
  actionNow: string[];
  actionWeek: string[];
  actionLong: string[];
  terms: BookletTerm[];
  appendixThemes: Array<{ name: string; quotes: BookletQuote[] }>;
};

type EpubChapterFile = {
  id: string;
  fileName: string;
  title: string;
  bodyHtml: string;
};

type QuoteEvidenceLine = {
  speakerKey: string;
  timestampKey: string;
  textKey: string;
};

type QuoteEvidenceIndex = {
  lines: QuoteEvidenceLine[];
  byTimestamp: Map<string, QuoteEvidenceLine[]>;
};

type SemanticSegment = {
  startIndex: number;
  endIndex: number;
  signals: string[];
};

type TopicTemplate = {
  title: string;
  intent: string;
  keywords: string[];
  actions: string[];
};

type ChapterPlanItem = {
  chapterIndex: number;
  title: string;
  range: string;
  segmentIds: string[];
  intent: string;
  startIndex: number;
  endIndex: number;
  signals: string[];
  topic: TopicTemplate | null;
  topicKeywords: string[];
};

type LlmChapterPlanHint = {
  chapterIndex: number;
  title: string;
  range: string;
  segmentIds: string[];
  intent: string;
  signals: string[];
  contextExcerpt: string;
  evidenceAnchors: BookletQuote[];
};

type ChapterEvidenceMap = Map<number, QuoteEvidenceIndex>;

const BOOK_CREATOR = "由播客转写整理（v1）";
const FALLBACK_SPEAKER = "Speaker";
const FALLBACK_TIMESTAMP = "--:--";
const UNSUPPORTED_EVIDENCE_TEXT = "未在原文中明确说明。";
const MIN_CHAPTER_COUNT = 5;
const MAX_CHAPTER_COUNT = 7;
const SEGMENT_MIN_ENTRIES = 8;
const SEGMENT_TIME_GAP_SECONDS = 4 * 60;
const MERGE_CAPS = {
  suitableFor: 5,
  outcomes: 5,
  chapterPoints: 5,
  chapterQuotes: 4,
  chapterActions: 4,
  tldr: 7,
  actionNow: 3,
  actionWeek: 3,
  actionLong: 2,
  terms: 6,
  appendixThemes: 4,
  appendixThemeQuotes: 6,
  draftTermsMin: 2,
} as const;
const CJK_STOPWORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "就是",
  "然后",
  "因为",
  "所以",
  "可以",
  "不是",
  "没有",
  "一个",
  "一些",
  "还是",
  "自己",
  "如果",
  "时候",
  "今天",
  "觉得",
  "真的",
  "现在",
  "这样",
]);

function languageToDc(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return "zh";
  }
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return normalized.split("-")[0] ?? "en";
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(input: string): string {
  return escapeXml(input);
}

function cleanLine(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function uniqueNonEmpty(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines.map(cleanLine)) {
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    out.push(line);
  }
  return out;
}

function splitSentences(input: string): string[] {
  const coarse = input.split(/[\n。！？!?；;]/);
  const pieces: string[] = [];
  for (const sentence of coarse) {
    if (sentence.length > 90) {
      pieces.push(...sentence.split(/[，,、]/));
    } else {
      pieces.push(sentence);
    }
  }
  return uniqueNonEmpty(pieces.map(sanitizeSentence).filter(isMeaningfulSentence));
}

function shorten(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1)}…`;
}

function fillToCount<T>(values: T[], count: number, fallback: (index: number) => T): T[] {
  const out = values.slice(0, count);
  while (out.length < count) {
    out.push(fallback(out.length));
  }
  return out;
}

function parseTimestampToSeconds(input: string): number | null {
  const normalized = cleanLine(input);
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] ?? 0);
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(third)) {
    return null;
  }
  const hours = match[3] ? first : 0;
  const minutes = match[3] ? second : first;
  const seconds = match[3] ? third : second;
  return hours * 3600 + minutes * 60 + seconds;
}

function hasTopicShiftCue(text: string): boolean {
  return /(下面|接下来|下一个|进入正题|回到|总结一下|最后一个|最后我们|我们聊一下|第二个问题|第三个问题)/.test(
    text,
  );
}

function hasQuestionCue(text: string): boolean {
  return /(\?|？|想问|怎么|为什么|是什么)/.test(text);
}

function detectSemanticSegments(entries: TranscriptEntry[]): SemanticSegment[] {
  if (!entries.length) {
    return [];
  }

  const segments: SemanticSegment[] = [];
  let startIndex = 0;
  let pendingSignals: string[] = ["start"];

  for (let index = 1; index < entries.length; index += 1) {
    const current = entries[index];
    const previous = entries[index - 1];
    const signals: string[] = [];
    const currentLen = index - startIndex;

    if (hasTopicShiftCue(current.text)) {
      signals.push("topic_shift");
    }
    if (currentLen >= SEGMENT_MIN_ENTRIES && hasQuestionCue(current.text)) {
      signals.push("question_turn");
    }

    const currentTs = parseTimestampToSeconds(current.timestamp);
    const previousTs = parseTimestampToSeconds(previous?.timestamp ?? "");
    if (
      currentLen >= SEGMENT_MIN_ENTRIES &&
      currentTs != null &&
      previousTs != null &&
      currentTs - previousTs >= SEGMENT_TIME_GAP_SECONDS
    ) {
      signals.push("time_gap");
    }

    if (!signals.length || currentLen < SEGMENT_MIN_ENTRIES) {
      continue;
    }

    segments.push({
      startIndex,
      endIndex: index - 1,
      signals: uniqueNonEmpty(pendingSignals),
    });
    startIndex = index;
    pendingSignals = signals;
  }

  segments.push({
    startIndex,
    endIndex: entries.length - 1,
    signals: uniqueNonEmpty(pendingSignals.length ? pendingSignals : ["continuation"]),
  });

  return segments.filter((segment) => segment.endIndex >= segment.startIndex);
}

function targetChapterCount(entryCount: number): number {
  if (entryCount < 70) {
    return MIN_CHAPTER_COUNT;
  }
  if (entryCount < 150) {
    return 6;
  }
  return MAX_CHAPTER_COUNT;
}

function segmentLength(segment: SemanticSegment): number {
  return segment.endIndex - segment.startIndex + 1;
}

function mergeSegmentsToMax(segments: SemanticSegment[], maxCount: number): SemanticSegment[] {
  const out = [...segments];
  while (out.length > maxCount) {
    let mergeIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < out.length - 1; index += 1) {
      const score = segmentLength(out[index] as SemanticSegment) + segmentLength(out[index + 1] as SemanticSegment);
      if (score < bestScore) {
        bestScore = score;
        mergeIndex = index;
      }
    }
    const left = out[mergeIndex] as SemanticSegment;
    const right = out[mergeIndex + 1] as SemanticSegment;
    const merged: SemanticSegment = {
      startIndex: left.startIndex,
      endIndex: right.endIndex,
      signals: uniqueNonEmpty([...left.signals, ...right.signals, "merged"]),
    };
    out.splice(mergeIndex, 2, merged);
  }
  return out;
}

function splitSegmentsToMin(segments: SemanticSegment[], minCount: number): SemanticSegment[] {
  const out = [...segments];
  while (out.length < minCount) {
    let splitIndex = -1;
    let maxLen = 0;
    for (let index = 0; index < out.length; index += 1) {
      const len = segmentLength(out[index] as SemanticSegment);
      if (len > maxLen) {
        maxLen = len;
        splitIndex = index;
      }
    }
    if (splitIndex === -1 || maxLen < 2) {
      break;
    }
    const target = out[splitIndex] as SemanticSegment;
    const mid = target.startIndex + Math.floor(maxLen / 2);
    const left: SemanticSegment = {
      startIndex: target.startIndex,
      endIndex: mid - 1,
      signals: uniqueNonEmpty([...target.signals, "split_left"]),
    };
    const right: SemanticSegment = {
      startIndex: mid,
      endIndex: target.endIndex,
      signals: uniqueNonEmpty([...target.signals, "split_right"]),
    };
    const next: SemanticSegment[] = [];
    if (left.endIndex >= left.startIndex) {
      next.push(left);
    }
    if (right.endIndex >= right.startIndex) {
      next.push(right);
    }
    if (!next.length) {
      break;
    }
    out.splice(splitIndex, 1, ...next);
  }
  return out;
}

function planSemanticSegments(entries: TranscriptEntry[]): SemanticSegment[] {
  if (!entries.length) {
    return [];
  }
  const detected = detectSemanticSegments(entries);
  let planned = detected.length
    ? detected
    : [
        {
          startIndex: 0,
          endIndex: entries.length - 1,
          signals: ["fallback_single"],
        },
      ];
  const target = targetChapterCount(entries.length);
  planned = mergeSegmentsToMax(planned, Math.min(MAX_CHAPTER_COUNT, target));
  planned = splitSegmentsToMin(planned, Math.max(MIN_CHAPTER_COUNT, Math.min(MAX_CHAPTER_COUNT, target)));
  return planned.filter((segment) => segment.endIndex >= segment.startIndex);
}

const NOISE_KEYWORDS = new Set([
  "speaker",
  "host",
  "guest",
  "keywords",
  "transcript",
  "cst",
  "min",
  "哈哈",
  "哈哈哈",
  "确实",
  "然后",
  "就是",
  "嗯",
  "诶",
  "这个",
  "那个",
  "是的",
  "对对对",
  "我说",
  "可以的",
  "好的",
  "不是",
  "然后",
  "其实",
  "没有",
  "一个",
  "我们",
]);

const EN_STOPWORDS = new Set([
  "every",
  "just",
  "your",
  "yeah",
  "okay",
  "fine",
  "really",
  "very",
  "with",
  "this",
  "that",
  "then",
  "from",
  "have",
  "been",
  "into",
  "when",
  "what",
  "where",
  "which",
  "they",
  "them",
  "their",
  "about",
  "because",
  "like",
  "kind",
  "fire",
  "for",
  "the",
  "and",
]);

const TOPIC_TEMPLATES: TopicTemplate[] = [
  {
    title: "开场与话题设定",
    intent: "set-context-and-goals",
    keywords: ["今天", "话题", "亲子关系", "开始", "介绍", "update", "近况"],
    actions: ["列出你本期最关注的 3 个问题，按优先级排序。", "用一句话写下你听完这期后最想解决的核心冲突。"],
  },
  {
    title: "边界框架与识别",
    intent: "define-concepts-and-boundaries",
    keywords: ["边界", "情感", "物质", "时间", "物理", "界限", "独立"],
    actions: ["把你的冲突按情感/物质/时间/物理四类各写 1 个例子。", "给每类冲突补 1 条替代行为，而不是只写抱怨。"],
  },
  {
    title: "常见冲突与触发点",
    intent: "diagnose-conflicts-and-triggers",
    keywords: ["冲突", "定居", "催婚", "工作", "稳定", "焦虑", "价值观", "父母"],
    actions: ["把冲突拆成“事实问题”和“情绪问题”两列，先处理事实。", "提前写好 1 句降温回应，避免在高情绪时硬碰硬。"],
  },
  {
    title: "沟通策略与减摩擦",
    intent: "communication-and-friction-reduction",
    keywords: ["沟通", "陪伴", "管理", "情绪", "外包", "敷衍", "策略", "电话"],
    actions: ["准备一句可复用的结束语，避免对话升级。", "选 1 件高摩擦家务，尝试第三方服务或流程替代。"],
  },
  {
    title: "内疚、支持与关系修复",
    intent: "repair-relationship-and-support",
    keywords: ["内疚", "回报", "支持", "亲密", "理解", "关系", "成长", "爱"],
    actions: ["写下“我需要的是___，不是___”并在下一次沟通中使用。", "每周安排一次低冲突触达，只分享近况不讨论争议议题。"],
  },
  {
    title: "家庭模式观察",
    intent: "observe-family-patterns",
    keywords: ["朋友", "家庭", "模式", "聊天", "理想", "东亚", "差异", "话题"],
    actions: ["建立一份非评判型话题清单（新闻/旅行/生活小事）。", "给家庭沟通设定最低可持续频率并坚持 4 周。"],
  },
  {
    title: "下一代与长期行动",
    intent: "long-term-practices",
    keywords: ["父母", "孩子", "支持", "犯错", "安全感", "习惯", "长期", "行动"],
    actions: ["写下 1 条你未来做父母“绝不做”的行为规则。", "把本期最认同的 1 条原则转成可量化习惯并追踪。"],
  },
];

function normalizeSpeaker(raw: string): string {
  const normalized = cleanLine(raw.replace(/[：:]+$/, ""));
  if (!normalized) {
    return FALLBACK_SPEAKER;
  }
  if (/^speaker\s*\d+$/i.test(normalized)) {
    return normalized.replace(/^speaker/i, "Speaker");
  }
  return normalized;
}

function stripTranscriptLineDecorators(input: string): string {
  let line = cleanLine(input);
  line = line.replace(/^\s*(?:[-*•]\s+)/, "");
  line = line.replace(/^\s*(?:>\s*)?#{1,6}\s*/, "");
  line = line.replace(/^\s*[0-9]+\s*[.)]\s+/, "");
  line = line.replace(/^\s*[一二三四五六七八九十百千万]+\s*[、.]\s+/, "");
  line = line.replace(/^\s*[\*_"'`~]{1,3}\s*/g, "");
  line = line.replace(/\s*[\*_"'`~]{1,3}\s*$/g, "");
  return line;
}

function isMarkdownStructuralLine(input: string): boolean {
  const line = cleanLine(input);
  return /^#{1,6}(?:\s|$)/.test(line) || /^\s*[-*•]+\s*#{1,6}(?:\s|$)/.test(line);
}

function sanitizeSentence(input: string): string {
  const stripped = stripTranscriptLineDecorators(input);
  return cleanLine(
    stripped
      .replace(/^[\-\*•]+\s*/, "")
      .replace(/^(Speaker|主持人|嘉宾|主播)\s*[,:：]?\s*/, "")
      .replace(/^\d+\s*[.)]\s*/, "")
      .replace(/^(嗯+|啊+|呃+|诶+)\s*/i, "")
      .replace(/^(哈哈)+[哈]*\s*/i, "")
      .replace(/^(然后|就是|但是|所以|对|然后就是|我觉得|其实)\s*/i, ""),
  );
}

function isMeaningfulSentence(input: string): boolean {
  if (isMarkdownStructuralLine(input)) {
    return false;
  }
  const line = sanitizeSentence(input);
  if (line.length < 8) {
    return false;
  }
  if (/^(keywords|transcript)\s*:?$/i.test(line)) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(line) && /cst|h\s*\d+\s*min/i.test(line)) {
    return false;
  }
  if (/^(哈哈)+[哈]*[.!?。！？]*$/i.test(line)) {
    return false;
  }
  if (/^speaker\s*\d*$/i.test(line)) {
    return false;
  }
  const hanCount = (line.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (line.match(/[A-Za-z]/g) ?? []).length;
  if (hanCount === 0 && latinCount > 0 && line.length < 20) {
    return false;
  }
  return true;
}

function isLikelyKeywordList(line: string): boolean {
  const parts = line.split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 8 && !/[。.!?？!]/.test(line);
}

function extractTranscriptBody(input: string): string {
  const normalized = input.replace(/\uFFFD/g, " ");
  const markerMatch = normalized.match(/transcript\s*:/i);
  if (markerMatch?.index != null) {
    return normalized.slice(markerMatch.index + markerMatch[0].length);
  }
  return normalized;
}

function extractKeywords(input: string): string[] {
  const hanDominant = (input.match(/[\u4e00-\u9fff]/g) ?? []).length >= 40;
  const tokens = input.match(/[\p{Script=Han}]{2,}|[A-Za-z]{4,}/gu) ?? [];
  const scored = new Map<string, number>();
  for (const tokenRaw of tokens) {
    const token = /[A-Za-z]/.test(tokenRaw) ? tokenRaw.toLowerCase() : tokenRaw;
    if (token.length < 2 || CJK_STOPWORDS.has(token) || NOISE_KEYWORDS.has(token) || EN_STOPWORDS.has(token)) {
      continue;
    }
    if (/^(是的|对+|嗯+|啊+|我说|好的|可以|然后|就是)$/.test(token)) {
      continue;
    }
    if (hanDominant && /[A-Za-z]/.test(token)) {
      continue;
    }
    scored.set(token, (scored.get(token) ?? 0) + 1);
  }
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token);
}

function parseTranscriptEntries(transcriptText: string): TranscriptEntry[] {
  const lines = extractTranscriptBody(transcriptText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isMarkdownStructuralLine(line))
    .filter((line) => !/^(keywords|transcript)\s*:?$/i.test(line))
    .filter((line) => !isLikelyKeywordList(line))
    .filter((line) => !/^\d{4}-\d{2}-\d{2}/.test(line) || !/cst|h\s*\d+\s*min/i.test(line));
  if (!lines.length) {
    return [];
  }

  const entries: TranscriptEntry[] = [];
  let pendingSpeaker: string | null = null;
  let pendingTimestamp: string | null = null;
  let pendingText: string[] = [];

  const flushPending = () => {
    const text = sanitizeSentence(pendingText.join(" "));
    if (pendingSpeaker && isMeaningfulSentence(text)) {
      entries.push({
        speaker: normalizeSpeaker(pendingSpeaker),
        timestamp: pendingTimestamp ?? FALLBACK_TIMESTAMP,
        text,
      });
    }
    pendingSpeaker = null;
    pendingTimestamp = null;
    pendingText = [];
  };

  const speakerMarkerWithInline =
    /^(Speaker\s*\d+|主持人|嘉宾|主播|Host|Guest)\s*[:：]?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/i;
  const speakerMarkerOnly =
    /^(Speaker\s*\d+|主持人|嘉宾|主播|Host|Guest)\s*[:：]?\s+(\d{1,2}:\d{2}(?::\d{2})?)$/i;
  const genericMarkerOnly = /^([^0-9][^\s]{0,18})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/;

  for (const line of lines) {
    const inlineMatch = line.match(speakerMarkerWithInline);
    if (inlineMatch && inlineMatch[1] && inlineMatch[2] && inlineMatch[3]) {
      flushPending();
      const text = sanitizeSentence(inlineMatch[3]);
      if (isMeaningfulSentence(text)) {
        entries.push({
          speaker: normalizeSpeaker(inlineMatch[1]),
          timestamp: inlineMatch[2],
          text,
        });
      }
      continue;
    }

    const markerMatch = line.match(speakerMarkerOnly);
    if (markerMatch && markerMatch[1] && markerMatch[2]) {
      flushPending();
      pendingSpeaker = markerMatch[1];
      pendingTimestamp = markerMatch[2];
      continue;
    }

    const genericMatch = line.match(genericMarkerOnly);
    if (genericMatch && genericMatch[1] && genericMatch[2]) {
      flushPending();
      pendingSpeaker = genericMatch[1];
      pendingTimestamp = genericMatch[2];
      continue;
    }

    if (pendingSpeaker) {
      pendingText.push(line);
      continue;
    }

    if (isMeaningfulSentence(line)) {
      entries.push({
        speaker: FALLBACK_SPEAKER,
        timestamp: FALLBACK_TIMESTAMP,
        text: sanitizeSentence(line),
      });
    }
  }

  flushPending();
  return entries;
}

function normalizeEvidenceSpeaker(input: string): string {
  return cleanLine(input).toLowerCase().replace(/\s+/g, "");
}

function normalizeEvidenceTimestamp(input: string): string {
  const match = cleanLine(input).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return "";
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] ?? 0);
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(third)) {
    return "";
  }
  // Treat HH:MM as MM:SS for transcript-style timestamps.
  const hours = match[3] ? first : 0;
  const minutes = match[3] ? second : first;
  const seconds = match[3] ? third : second;
  return `${hours}:${minutes}:${seconds}`;
}

function normalizeEvidenceText(input: string): string {
  return cleanLine(input)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function buildQuoteEvidenceIndex(entries: TranscriptEntry[]): QuoteEvidenceIndex {
  const lines: QuoteEvidenceLine[] = [];
  const byTimestamp = new Map<string, QuoteEvidenceLine[]>();
  for (const entry of entries) {
    const textKey = normalizeEvidenceText(entry.text);
    if (!textKey) {
      continue;
    }
    const line: QuoteEvidenceLine = {
      speakerKey: normalizeEvidenceSpeaker(entry.speaker || FALLBACK_SPEAKER),
      timestampKey: normalizeEvidenceTimestamp(entry.timestamp),
      textKey,
    };
    lines.push(line);
    if (line.timestampKey) {
      const bucket = byTimestamp.get(line.timestampKey) ?? [];
      bucket.push(line);
      byTimestamp.set(line.timestampKey, bucket);
    }
  }
  return { lines, byTimestamp };
}

function isQuoteTextSupportedByLine(quoteKey: string, lineKey: string): boolean {
  if (!quoteKey || !lineKey) {
    return false;
  }
  if (lineKey.includes(quoteKey)) {
    return true;
  }
  if (quoteKey.length >= 14 && quoteKey.includes(lineKey) && lineKey.length >= 12) {
    return true;
  }
  return false;
}

function isQuoteSupportedByEvidence(quote: BookletQuote, evidence: QuoteEvidenceIndex): boolean {
  const quoteKey = normalizeEvidenceText(quote.text);
  if (quoteKey.length < 6) {
    return false;
  }
  const quoteTsKey = normalizeEvidenceTimestamp(quote.timestamp);
  const quoteSpeakerKey = normalizeEvidenceSpeaker(quote.speaker || FALLBACK_SPEAKER);

  if (quoteTsKey) {
    const tsCandidates = evidence.byTimestamp.get(quoteTsKey) ?? [];
    const scopedCandidates =
      quoteSpeakerKey && quoteSpeakerKey !== normalizeEvidenceSpeaker(FALLBACK_SPEAKER)
        ? tsCandidates.filter((line) => line.speakerKey === quoteSpeakerKey)
        : tsCandidates;
    const effectiveCandidates = scopedCandidates.length ? scopedCandidates : tsCandidates;
    if (effectiveCandidates.length) {
      return effectiveCandidates.some((line) => isQuoteTextSupportedByLine(quoteKey, line.textKey));
    }
  }

  return evidence.lines.some((line) => isQuoteTextSupportedByLine(quoteKey, line.textKey));
}

function toRange(entries: TranscriptEntry[]): string {
  const timestamps = entries.map((entry) => entry.timestamp).filter((ts) => ts && ts !== FALLBACK_TIMESTAMP);
  if (!timestamps.length) {
    return "原文片段";
  }
  return `${timestamps[0]} - ${timestamps[timestamps.length - 1]}`;
}

function keywordHitCount(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

function pickTopicTemplate(chunkText: string, usedTitles: Set<string>): TopicTemplate | null {
  const scored = TOPIC_TEMPLATES.map((topic) => ({
    topic,
    score: keywordHitCount(chunkText, topic.keywords),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const item of scored) {
    if (!usedTitles.has(item.topic.title)) {
      return item.topic;
    }
  }
  return scored[0]?.topic ?? null;
}

function chapterTitleFromChunk(
  index: number,
  chunk: TranscriptEntry[],
  usedTopicTitles: Set<string>,
): { title: string; topic: TopicTemplate | null } {
  const chunkText = chunk.map((entry) => entry.text).join(" ");
  const matchedTopic = pickTopicTemplate(chunkText, usedTopicTitles);
  if (matchedTopic) {
    usedTopicTitles.add(matchedTopic.title);
    return { title: matchedTopic.title, topic: matchedTopic };
  }

  const keywords = extractKeywords(chunkText).slice(0, 2);
  if (!keywords.length) {
    return { title: `核心主题 ${index}`, topic: null };
  }
  return { title: keywords.join(" / "), topic: null };
}

function buildChapterPlan(entries: TranscriptEntry[], segments: SemanticSegment[]): ChapterPlanItem[] {
  const usedTopicTitles = new Set<string>();
  return segments.map((segment, index) => {
    const chapterIndex = index + 1;
    const chunk = entries.slice(segment.startIndex, segment.endIndex + 1);
    const titleMatch = chapterTitleFromChunk(chapterIndex, chunk, usedTopicTitles);
    return {
      chapterIndex,
      title: titleMatch.title,
      range: toRange(chunk),
      segmentIds: [`seg_${String(chapterIndex).padStart(2, "0")}`],
      intent: titleMatch.topic?.intent ?? "summarize-and-apply",
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      signals: segment.signals,
      topic: titleMatch.topic,
      topicKeywords: titleMatch.topic?.keywords ?? [],
    };
  });
}

function buildChapterEvidenceMap(entries: TranscriptEntry[], chapterPlans: ChapterPlanItem[]): ChapterEvidenceMap {
  const map: ChapterEvidenceMap = new Map();
  for (const plan of chapterPlans) {
    const chunk = entries.slice(plan.startIndex, plan.endIndex + 1);
    map.set(plan.chapterIndex, buildQuoteEvidenceIndex(chunk));
  }
  return map;
}

function buildChapterContextExcerpt(chunk: TranscriptEntry[]): string {
  const excerpt = uniqueNonEmpty(chunk.map((entry) => sanitizeSentence(entry.text)).filter(isMeaningfulSentence))
    .slice(0, 4)
    .join("；");
  return shorten(excerpt || UNSUPPORTED_EVIDENCE_TEXT, 300);
}

function chapterPointsFromChunk(title: string, chunk: TranscriptEntry[], topicKeywords: string[]): string[] {
  const candidates = uniqueNonEmpty(
    chunk
      .flatMap((entry) => splitSentences(entry.text))
      .map((sentence) => shorten(sentence, 72))
      .filter(isMeaningfulSentence),
  );

  const scored = candidates
    .map((sentence) => {
      const keywordScore = keywordHitCount(sentence, topicKeywords) * 3;
      const actionHint = /(可以|需要|应该|问题|冲突|边界|沟通|焦虑|支持|关系|策略|方法|做法)/.test(sentence) ? 2 : 0;
      const lengthScore = sentence.length >= 14 && sentence.length <= 60 ? 2 : 1;
      return { sentence, score: keywordScore + actionHint + lengthScore };
    })
    .sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)
    .map((item) => item.sentence);

  return fillToCount(
    uniqueNonEmpty(
      scored.map((line) => {
        if (line.length <= 58) {
          return line;
        }
        const clauses = line.split(/[，,、；;]/).map((part) => sanitizeSentence(part)).filter(isMeaningfulSentence);
        const compact = clauses.slice(0, 2).join("，");
        return shorten(compact || line, 58);
      }),
    ).slice(0, 3),
    3,
    (fallbackIndex) => `围绕“${title}”的关键观点 ${fallbackIndex + 1}。`,
  );
}

function chapterQuotesFromChunk(points: string[], chunk: TranscriptEntry[]): BookletQuote[] {
  const quoteCandidates = chunk
    .filter((entry) => entry.timestamp !== FALLBACK_TIMESTAMP && isMeaningfulSentence(entry.text))
    .map((entry) => ({
      speaker: entry.speaker || FALLBACK_SPEAKER,
      timestamp: entry.timestamp || FALLBACK_TIMESTAMP,
      text: shorten(entry.text, 180),
      score:
        (entry.text.length >= 24 ? 2 : 0) +
        (/(边界|冲突|沟通|关系|支持|焦虑|行动|父母|孩子)/.test(entry.text) ? 3 : 0) +
        (/(欢迎来到|我是|哈哈|好的|嗯|诶)/.test(entry.text) ? -2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const withoutGreetings = quoteCandidates.filter(
    (quote) => !/(欢迎来到|我是大福|我是康|自我介绍终于结束)/.test(quote.text),
  );
  const source = withoutGreetings.length ? withoutGreetings : quoteCandidates;
  const picked = source.slice(0, 2).map(({ speaker, timestamp, text }) => ({ speaker, timestamp, text }));
  return fillToCount(picked, 2, (index) => ({
    speaker: FALLBACK_SPEAKER,
    timestamp: FALLBACK_TIMESTAMP,
    text: points[index] ?? "该章节强调把讨论转换为可执行动作。",
  }));
}

function chapterActionsFromPoints(points: string[], topic: TopicTemplate | null): string[] {
  if (topic) {
    return fillToCount(topic.actions.slice(0, 2), 2, (index) => `行动 ${index + 1}：从本章整理 1 条可量化实践。`);
  }
  return [
    "把本章要点写成“继续做 / 停止做 / 尝试做”三列，并各填 1 条。",
    `在 48 小时内验证 1 条观点：${shorten(points[0] ?? "选择本章最关键观点", 24)}。`,
  ];
}

function chapterExplanationFromPoints(title: string, points: string[]): BookletChapterExplanation {
  const lead = points[0] ?? `本章围绕“${title}”展开。`;
  const concept = points[1] ?? lead;
  return {
    background: shorten(`讨论背景：${lead}`, 180),
    coreConcept: shorten(`核心概念：${concept}`, 180),
    judgmentFramework: "判断标准/框架：优先选择可被原文时间戳支持、且能转化为具体行为的观点。",
    commonMisunderstanding: "常见误解：只讨论立场对错而忽略执行路径，导致冲突重复发生。",
  };
}

function cleanBookletField(input: string, maxLength: number): string {
  return cleanLine(input).replace(/^[，。！？、\-\s]+/, "").slice(0, maxLength).trim();
}

function cleanBookletTimestamp(input: string, maxLength: number): string {
  return cleanLine(input).slice(0, maxLength).trim();
}

function chooseListWithFallback(
  preferred: string[],
  fallback: string[],
  count: number,
  maxLength: number,
  fallbackFactory?: (index: number) => string,
): string[] {
  const chosen = uniqueNonEmpty(preferred.map((item) => cleanBookletField(item, maxLength)).filter(Boolean)).slice(
    0,
    count,
  );
  const fallbackClean = uniqueNonEmpty(
    fallback.map((item) => cleanBookletField(item, maxLength)).filter(Boolean),
  ).slice(0, count);
  const merged = uniqueNonEmpty([...chosen, ...fallbackClean]).slice(0, count);
  if (merged.length) {
    return merged;
  }
  if (!fallbackFactory) {
    return [];
  }
  return uniqueNonEmpty(
    Array.from({ length: count }, (_, index) => cleanBookletField(fallbackFactory(index), maxLength)).filter(Boolean),
  ).slice(0, count);
}

function chooseQuoteListWithFallback(
  preferred: BookletQuote[],
  fallback: BookletQuote[],
  count: number,
  evidence: QuoteEvidenceIndex,
): BookletQuote[] {
  const cleanQuotes = (quotes: BookletQuote[]): BookletQuote[] =>
    quotes
      .map((quote) => ({
        speaker: cleanBookletField(quote.speaker || FALLBACK_SPEAKER, 32) || FALLBACK_SPEAKER,
        timestamp: cleanBookletTimestamp(quote.timestamp || FALLBACK_TIMESTAMP, 20) || FALLBACK_TIMESTAMP,
        text: cleanBookletField(quote.text, 200),
      }))
      .filter((quote) => quote.text);

  const preferredSupported = cleanQuotes(preferred).filter((quote) => isQuoteSupportedByEvidence(quote, evidence));
  const merged = [...preferredSupported, ...cleanQuotes(fallback)];
  const seen = new Set<string>();
  const unique: BookletQuote[] = [];
  for (const quote of merged) {
    const key = `${quote.speaker}|${quote.timestamp}|${quote.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(quote);
    if (unique.length >= count) {
      break;
    }
  }
  if (unique.length) {
    return unique;
  }
  return [
    {
      speaker: FALLBACK_SPEAKER,
      timestamp: FALLBACK_TIMESTAMP,
      text: UNSUPPORTED_EVIDENCE_TEXT,
    },
  ];
}

function mergeBookletWithLlmDraft(
  base: BookletModel,
  draft: Awaited<ReturnType<typeof generateBookletDraftWithLlm>>,
  evidence: QuoteEvidenceIndex,
  chapterEvidenceMap: ChapterEvidenceMap,
): BookletModel {
  if (!draft) {
    return base;
  }

  const chapters = base.chapters.map((chapter, index) => {
    const draftChapter = draft.chapters[index];
    if (!draftChapter) {
      return chapter;
    }
    const chapterEvidence = chapterEvidenceMap.get(chapter.index) ?? evidence;

    return {
      ...chapter,
      title: cleanBookletField(draftChapter.title || chapter.title, 48) || chapter.title,
      points: chooseListWithFallback(draftChapter.points, chapter.points, MERGE_CAPS.chapterPoints, 120),
      quotes: chooseQuoteListWithFallback(draftChapter.quotes, chapter.quotes, MERGE_CAPS.chapterQuotes, chapterEvidence),
      explanation: {
        background:
          cleanBookletField(draftChapter.explanation.background || chapter.explanation.background, 220) ||
          chapter.explanation.background,
        coreConcept:
          cleanBookletField(draftChapter.explanation.coreConcept || chapter.explanation.coreConcept, 220) ||
          chapter.explanation.coreConcept,
        judgmentFramework:
          cleanBookletField(
            draftChapter.explanation.judgmentFramework || chapter.explanation.judgmentFramework,
            220,
          ) || chapter.explanation.judgmentFramework,
        commonMisunderstanding:
          cleanBookletField(
            draftChapter.explanation.commonMisunderstanding || chapter.explanation.commonMisunderstanding,
            220,
          ) || chapter.explanation.commonMisunderstanding,
      },
      actions: chooseListWithFallback(draftChapter.actions, chapter.actions, MERGE_CAPS.chapterActions, 120),
    };
  });

  const actionFallback = chapters.flatMap((chapter) => chapter.actions);
  const mergedAppendixThemes = draft.appendixThemes
    .slice(0, MERGE_CAPS.appendixThemes)
    .map((theme, index) => ({
      name: cleanBookletField(theme.name, 40) || `主题 ${index + 1}`,
      quotes: chooseQuoteListWithFallback(
        theme.quotes,
        base.appendixThemes[index]?.quotes ?? base.appendixThemes[0]?.quotes ?? [],
        MERGE_CAPS.appendixThemeQuotes,
        evidence,
      ),
    }));

  return {
    ...base,
    suitableFor: chooseListWithFallback(draft.suitableFor, base.suitableFor, MERGE_CAPS.suitableFor, 120),
    outcomes: chooseListWithFallback(draft.outcomes, base.outcomes, MERGE_CAPS.outcomes, 120),
    oneLineConclusion:
      cleanBookletField(draft.oneLineConclusion || base.oneLineConclusion, 180) || base.oneLineConclusion,
    tldr: chooseListWithFallback(draft.tldr, base.tldr, MERGE_CAPS.tldr, 180, (index) => base.tldr[index] ?? `要点 ${index + 1}`),
    chapters,
    actionNow: chooseListWithFallback(draft.actionNow, actionFallback.slice(0, 3), MERGE_CAPS.actionNow, 120),
    actionWeek: chooseListWithFallback(draft.actionWeek, actionFallback.slice(3, 6), MERGE_CAPS.actionWeek, 120),
    actionLong: chooseListWithFallback(draft.actionLong, actionFallback.slice(6, 8), MERGE_CAPS.actionLong, 120),
    terms:
      draft.terms.length >= MERGE_CAPS.draftTermsMin
        ? draft.terms.slice(0, MERGE_CAPS.terms).map((term) => ({
            term: cleanBookletField(term.term, 30),
            definition: cleanBookletField(term.definition, 120),
          }))
        : base.terms,
    appendixThemes: mergedAppendixThemes.length ? mergedAppendixThemes : base.appendixThemes,
  };
}

async function buildBookletModel(params: {
  jobId: string;
  title: string;
  language: string;
  templateId: string;
  sourceType: SourceType;
  sourceRef: string;
  transcriptText: string;
  inspector?: (stage: InspectorPushInput) => void;
}): Promise<BookletModel> {
  const entries = parseTranscriptEntries(params.transcriptText);
  const transcriptBody = extractTranscriptBody(params.transcriptText);
  const plannedSegments = planSemanticSegments(entries);
  const chapterPlan = buildChapterPlan(entries, plannedSegments);
  const chapters = chapterPlan.map((plan) => {
    const chunk = entries.slice(plan.startIndex, plan.endIndex + 1);
    const points = chapterPointsFromChunk(plan.title, chunk, plan.topicKeywords);
    const quotes = chapterQuotesFromChunk(points, chunk);
    const explanation = chapterExplanationFromPoints(plan.title, points);
    return {
      index: plan.chapterIndex,
      sectionId: `chap_${String(plan.chapterIndex + 3).padStart(2, "0")}`,
      title: plan.title,
      range: plan.range,
      points,
      quotes,
      explanation,
      actions: chapterActionsFromPoints(points, plan.topic),
    };
  });

  const topKeywords = extractKeywords(transcriptBody).slice(0, 6);
  const tldr = fillToCount(
    uniqueNonEmpty(
      chapters.map((chapter) => {
        const leadAction = chapter.actions[0]?.replace(/^行动\s*\d+：/, "") ?? "提炼关键实践。";
        return `第 ${chapter.index} 章聚焦${chapter.title}，建议：${shorten(leadAction, 30)}`;
      }),
    ).slice(0, 7),
    7,
    (index) => `要点 ${index + 1}：将本期信息整理为可执行的知识清单。`,
  );
  const terms = fillToCount(
    topKeywords.map((term) => ({
      term,
      definition: `在本期语境中，指与“${term}”相关的核心讨论与实践线索。`,
    })),
    3,
    (index) => ({
      term: `术语 ${index + 1}`,
      definition: "本期反复出现的重要概念，用于支撑核心观点。",
    }),
  );

  const generatedAtIso = new Date().toISOString();
  const generatedDate = generatedAtIso.slice(0, 10);
  const introKeyword = topKeywords.find((keyword) => /[\u4e00-\u9fff]/.test(keyword)) ?? "亲子关系";
  const quotePool = chapters.flatMap((chapter) => chapter.quotes).slice(0, 4);
  const appendixQuotes = fillToCount(quotePool, 4, (index) => ({
    speaker: FALLBACK_SPEAKER,
    timestamp: FALLBACK_TIMESTAMP,
    text: tldr[index] ?? "将听到的观点转化成行动，才会形成沉淀。",
  }));

  const baseModel: BookletModel = {
    meta: {
      identifier: `urn:booklet:${params.jobId}`,
      title: params.title,
      language: params.language,
      dcLanguage: languageToDc(params.language),
      creator: BOOK_CREATOR,
      generatedAtIso,
      generatedDate,
      sourceRef: params.sourceRef,
      sourceType: params.sourceType,
      templateId: params.templateId,
    },
    suitableFor: [
      "想把播客内容沉淀成长期笔记的听众。",
      `对“${introKeyword}”主题想建立系统理解的学习者。`,
      "需要把听后灵感转化为行动清单的人。",
    ],
    outcomes: [
      "拿到一份可检索、可复盘的章节化内容。",
      "快速定位关键观点与对应时间戳引用。",
      "直接使用行动清单推进下一步实践。",
    ],
    oneLineConclusion: `本期围绕${chapters
      .slice(1, 4)
      .map((chapter) => chapter.title)
      .join("、")}展开，核心是把冲突讨论转成可执行的边界与沟通动作。`,
    tldr,
    chapters,
    actionNow: chapters.flatMap((chapter) => chapter.actions).slice(0, 2),
    actionWeek: chapters.flatMap((chapter) => chapter.actions).slice(2, 4),
    actionLong: chapters.flatMap((chapter) => chapter.actions).slice(4, 6),
    terms,
    appendixThemes: [
      { name: "主题一：观点与判断", quotes: appendixQuotes.slice(0, 2) },
      { name: "主题二：行动与习惯", quotes: appendixQuotes.slice(2, 4) },
    ],
  };

  const llmDraft = await generateBookletDraftWithLlm({
    title: params.title,
    language: params.language,
    sourceType: params.sourceType,
    sourceRef: params.sourceRef,
    chapterRanges: baseModel.chapters.map((chapter) => `${chapter.title}（${chapter.range}）`),
    chapterPlans: chapterPlan.map((plan) => {
      const chunk = entries.slice(plan.startIndex, plan.endIndex + 1);
      const chapter = chapters[plan.chapterIndex - 1];
      return {
        chapterIndex: plan.chapterIndex,
        title: plan.title,
        range: plan.range,
        segmentIds: plan.segmentIds,
        intent: plan.intent,
        signals: plan.signals,
        contextExcerpt: buildChapterContextExcerpt(chunk),
        evidenceAnchors: (chapter?.quotes ?? []).slice(0, 3),
      } satisfies LlmChapterPlanHint;
    }),
    transcriptText: transcriptBody,
    inspector: {
      onRequest: (request) => {
        pushInspectorStage(params.inspector, {
          stage: "llm_request",
          input: {
            prompt_preview: request.promptPreview,
          },
          config: {
            model: request.model,
            temperature: request.temperature,
            timeout_ms: request.timeoutMs,
            input_max_chars: request.inputMaxChars,
            endpoint: request.endpoint,
          },
        });
      },
      onResponse: (response) => {
        pushInspectorStage(params.inspector, {
          stage: "llm_response",
          input: {
            http_status: response.httpStatus,
            raw_response_preview: response.rawContentPreview,
          },
          output: {
            parsed_chapters: response.parsedChapterCount,
            parsed_terms: response.parsedTermCount,
            parsed_tldr: response.parsedTldrCount,
            parse_ok: response.parseOk,
          },
        });
      },
      onError: (message) => {
        pushInspectorStage(params.inspector, {
          stage: "llm_response",
          notes: `LLM fallback path used: ${message}`,
          output: { parse_ok: false },
        });
      },
    },
  });
  const evidence = buildQuoteEvidenceIndex(entries);
  const chapterEvidenceMap = buildChapterEvidenceMap(entries, chapterPlan);
  const finalModel = mergeBookletWithLlmDraft(baseModel, llmDraft, evidence, chapterEvidenceMap);
  pushInspectorStage(params.inspector, {
    stage: "normalization",
    input: {
      parsed_entries: entries.length,
      planned_chapters: chapterPlan.length,
      llm_draft_available: Boolean(llmDraft),
      base_title: baseModel.meta.title,
    },
    output: {
      final_chapters: finalModel.chapters.length,
      chapter_titles: finalModel.chapters.map((chapter) => chapter.title),
      tldr_count: finalModel.tldr.length,
      terms_count: finalModel.terms.length,
    },
    config: {
      merge_caps: MERGE_CAPS,
      source_type: params.sourceType,
    },
  });
  return finalModel;
}

function buildMarkdownContent(model: BookletModel): string {
  const lines: string[] = [
    `# ${model.meta.title}`,
    "",
    `- Language: ${model.meta.language}`,
    `- Creator: ${model.meta.creator}`,
    `- Generated At: ${model.meta.generatedAtIso}`,
    `- Source Ref: ${model.meta.sourceRef}`,
    "",
    "## chap_01 - 读前速览",
    "",
    "### 这期适合谁",
    ...model.suitableFor.map((item) => `- ${item}`),
    "",
    "### 你会得到什么（可落地）",
    ...model.outcomes.map((item) => `- ${item}`),
    "",
    "### 一句话结论",
    `> ${model.oneLineConclusion}`,
    "",
    "## chap_02 - 关键要点摘要（TL;DR）",
    ...model.tldr.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## chap_03 - 目录（建议 5–7 章）",
    ...model.chapters.map((chapter) => `- 第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`),
    "",
  ];

  for (const chapter of model.chapters) {
    lines.push(`## ${chapter.sectionId} - 第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`);
    lines.push("");
    lines.push("### 本章要点");
    lines.push(...chapter.points.map((point) => `- ${point}`));
    lines.push("");
    lines.push("### 关键引用（带时间戳）");
    lines.push(...chapter.quotes.map((quote) => `- [${quote.timestamp}] **${quote.speaker}**：${quote.text}`));
    lines.push("");
    lines.push("### 解释与延展（落地版）");
    lines.push(`- 背景：${chapter.explanation.background}`);
    lines.push(`- 核心概念：${chapter.explanation.coreConcept}`);
    lines.push(`- 判断标准/框架：${chapter.explanation.judgmentFramework}`);
    lines.push(`- 常见误解：${chapter.explanation.commonMisunderstanding}`);
    lines.push("");
    lines.push("### 可执行行动");
    lines.push(...chapter.actions.map((action) => `- ${action}`));
    lines.push("");
  }

  lines.push("## chap_11 - 行动清单（汇总版）");
  lines.push("");
  lines.push("### 今天就做（≤ 15 分钟）");
  lines.push(...model.actionNow.map((action) => `- ${action}`));
  lines.push("");
  lines.push("### 这周内做（需要安排时间）");
  lines.push(...model.actionWeek.map((action) => `- ${action}`));
  lines.push("");
  lines.push("### 长期习惯（可量化）");
  lines.push(...model.actionLong.map((action) => `- ${action}`));
  lines.push("");
  lines.push("## chap_12 - 概念与术语表（v1）");
  lines.push(...model.terms.map((term) => `- **${term.term}**：${term.definition}`));
  lines.push("");
  lines.push("## chap_13 - 附录：精选原句（按主题）");
  for (const theme of model.appendixThemes) {
    lines.push("");
    lines.push(`### ${theme.name}`);
    lines.push(...theme.quotes.map((quote) => `- [${quote.timestamp}] **${quote.speaker}**：${quote.text}`));
  }
  lines.push("");
  lines.push("## chap_14 - 制作信息");
  lines.push(`- 输入：${model.meta.sourceType}`);
  lines.push(`- 结构模板：${model.meta.templateId}`);
  lines.push("- 整理规则：保留观点与行动，引用尽量带时间戳，必要口语润色但不改变含义");
  lines.push(`- 生成时间：${model.meta.generatedDate}`);
  lines.push(`- 来源追踪：${model.meta.sourceRef}`);
  lines.push("");
  return lines.join("\n");
}

function writePdfSectionTitle(doc: PDFKit.PDFDocument, heading: string): void {
  doc.fontSize(17).text(heading, { underline: true });
  doc.moveDown(0.6);
}

function writePdfBulletList(doc: PDFKit.PDFDocument, lines: string[]): void {
  for (const line of lines) {
    doc.fontSize(11).text(`• ${line}`, { paragraphGap: 4 });
  }
  doc.moveDown(0.2);
}

function writePdfQuoteList(doc: PDFKit.PDFDocument, quotes: BookletQuote[]): void {
  for (const quote of quotes) {
    doc.fontSize(11).text(`[${quote.timestamp}] ${quote.speaker}：${quote.text}`, { paragraphGap: 4 });
  }
  doc.moveDown(0.2);
}

async function writePdfArtifact(filePath: string, model: BookletModel): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const cjkFontPath = await resolveCjkFontPath();
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = doc.pipe(createWriteStream(filePath));

    if (cjkFontPath) {
      doc.font(cjkFontPath);
    }

    let sectionIndex = 0;
    const beginSection = (heading: string) => {
      if (sectionIndex > 0) {
        doc.addPage();
      }
      sectionIndex += 1;
      writePdfSectionTitle(doc, heading);
    };

    beginSection("chap_01 - 读前速览");
    doc.fontSize(20).text(model.meta.title);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Language: ${model.meta.language}`);
    doc.fontSize(10).text(`Generated: ${model.meta.generatedAtIso}`);
    doc.fontSize(10).text(`Source: ${model.meta.sourceRef}`);
    doc.moveDown(0.6);
    doc.fontSize(13).text("这期适合谁");
    writePdfBulletList(doc, model.suitableFor);
    doc.fontSize(13).text("你会得到什么（可落地）");
    writePdfBulletList(doc, model.outcomes);
    doc.fontSize(13).text("一句话结论");
    doc.fontSize(11).text(model.oneLineConclusion);

    beginSection("chap_02 - 关键要点摘要（TL;DR）");
    writePdfBulletList(
      doc,
      model.tldr.map((item, index) => `${index + 1}. ${item}`),
    );

    beginSection("chap_03 - 目录（建议 5–7 章）");
    writePdfBulletList(doc, model.chapters.map((chapter) => `第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`));

    for (const chapter of model.chapters) {
      beginSection(`${chapter.sectionId} - 第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`);
      doc.fontSize(13).text("本章要点");
      writePdfBulletList(doc, chapter.points);
      doc.fontSize(13).text("关键引用（带时间戳）");
      writePdfQuoteList(doc, chapter.quotes);
      doc.fontSize(13).text("解释与延展（落地版）");
      writePdfBulletList(doc, [
        `背景：${chapter.explanation.background}`,
        `核心概念：${chapter.explanation.coreConcept}`,
        `判断标准/框架：${chapter.explanation.judgmentFramework}`,
        `常见误解：${chapter.explanation.commonMisunderstanding}`,
      ]);
      doc.fontSize(13).text("可执行行动");
      writePdfBulletList(doc, chapter.actions);
    }

    beginSection("chap_11 - 行动清单（汇总版）");
    doc.fontSize(13).text("今天就做（≤ 15 分钟）");
    writePdfBulletList(doc, model.actionNow);
    doc.fontSize(13).text("这周内做（需要安排时间）");
    writePdfBulletList(doc, model.actionWeek);
    doc.fontSize(13).text("长期习惯（可量化）");
    writePdfBulletList(doc, model.actionLong);

    beginSection("chap_12 - 概念与术语表（v1）");
    writePdfBulletList(doc, model.terms.map((term) => `${term.term}：${term.definition}`));

    beginSection("chap_13 - 附录：精选原句（按主题）");
    for (const theme of model.appendixThemes) {
      doc.fontSize(13).text(theme.name);
      writePdfQuoteList(doc, theme.quotes);
    }

    beginSection("chap_14 - 制作信息");
    writePdfBulletList(doc, [
      `输入：${model.meta.sourceType}`,
      `结构模板：${model.meta.templateId}`,
      "整理规则：保留观点与行动，引用尽量带时间戳，必要口语润色但不改变含义",
      `生成时间：${model.meta.generatedDate}`,
      `来源追踪：${model.meta.sourceRef}`,
    ]);

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

function listToHtml(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function quoteListToHtml(quotes: BookletQuote[]): string {
  return `<ul class="quote-list">${quotes
    .map(
      (quote) =>
        `<li><p><span class="quote-ts">[${escapeHtml(quote.timestamp)}]</span> <strong>${escapeHtml(
          quote.speaker,
        )}</strong>：${escapeHtml(quote.text)}</p></li>`,
    )
    .join("")}</ul>`;
}

function buildEpubChapterFiles(model: BookletModel): EpubChapterFile[] {
  const files: EpubChapterFile[] = [];
  files.push({
    id: "chap_01",
    fileName: "chap_01.xhtml",
    title: "读前速览",
    bodyHtml: [
      "<h3>这期适合谁</h3>",
      listToHtml(model.suitableFor),
      "<h3>你会得到什么（可落地）</h3>",
      listToHtml(model.outcomes),
      "<h3>一句话结论</h3>",
      `<blockquote>${escapeHtml(model.oneLineConclusion)}</blockquote>`,
    ].join(""),
  });
  files.push({
    id: "chap_02",
    fileName: "chap_02.xhtml",
    title: "关键要点摘要（TL;DR）",
    bodyHtml: `<ol>${model.tldr.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`,
  });
  files.push({
    id: "chap_03",
    fileName: "chap_03.xhtml",
    title: "目录（建议 5-7 章）",
    bodyHtml: listToHtml(model.chapters.map((chapter) => `第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`)),
  });

  for (const chapter of model.chapters) {
    files.push({
      id: chapter.sectionId,
      fileName: `${chapter.sectionId}.xhtml`,
      title: `第 ${chapter.index} 章：${chapter.title}（${chapter.range}）`,
      bodyHtml: [
        "<h3>本章要点</h3>",
        listToHtml(chapter.points),
        "<h3>关键引用（带时间戳）</h3>",
        quoteListToHtml(chapter.quotes),
        "<h3>解释与延展（落地版）</h3>",
        listToHtml([
          `背景：${chapter.explanation.background}`,
          `核心概念：${chapter.explanation.coreConcept}`,
          `判断标准/框架：${chapter.explanation.judgmentFramework}`,
          `常见误解：${chapter.explanation.commonMisunderstanding}`,
        ]),
        "<h3>可执行行动</h3>",
        listToHtml(chapter.actions),
      ].join(""),
    });
  }

  files.push({
    id: "chap_11",
    fileName: "chap_11.xhtml",
    title: "行动清单（汇总版）",
    bodyHtml: [
      "<h3>今天就做（≤ 15 分钟）</h3>",
      listToHtml(model.actionNow),
      "<h3>这周内做（需要安排时间）</h3>",
      listToHtml(model.actionWeek),
      "<h3>长期习惯（可量化）</h3>",
      listToHtml(model.actionLong),
    ].join(""),
  });
  files.push({
    id: "chap_12",
    fileName: "chap_12.xhtml",
    title: "概念与术语表（v1）",
    bodyHtml: listToHtml(model.terms.map((term) => `${term.term}：${term.definition}`)),
  });
  files.push({
    id: "chap_13",
    fileName: "chap_13.xhtml",
    title: "附录：精选原句（按主题）",
    bodyHtml: model.appendixThemes
      .map((theme) => `<h3>${escapeHtml(theme.name)}</h3>${quoteListToHtml(theme.quotes)}`)
      .join(""),
  });
  files.push({
    id: "chap_14",
    fileName: "chap_14.xhtml",
    title: "制作信息",
    bodyHtml: listToHtml([
      `输入：${model.meta.sourceType}`,
      `结构模板：${model.meta.templateId}`,
      "整理规则：保留观点与行动，引用尽量带时间戳，必要口语润色但不改变含义",
      `生成时间：${model.meta.generatedDate}`,
      `来源追踪：${model.meta.sourceRef}`,
    ]),
  });

  return files;
}

function buildEpubChapterXhtml(chapter: EpubChapterFile, model: BookletModel): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(model.meta.dcLanguage)}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" type="text/css" href="styles.css" />
  </head>
  <body>
    <section>
      <h2>${escapeHtml(chapter.id)} - ${escapeHtml(chapter.title)}</h2>
      ${chapter.bodyHtml}
    </section>
  </body>
</html>
`;
}

function buildEpubNavXhtml(chapters: EpubChapterFile[], model: BookletModel): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(model.meta.dcLanguage)}">
  <head>
    <title>${escapeXml(model.meta.title)} - 导航</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeHtml(model.meta.title)}</h1>
      <ol>
        ${chapters.map((chapter) => `<li><a href="${escapeHtml(chapter.fileName)}">${escapeHtml(chapter.title)}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>
`;
}

function buildEpubTocNcx(chapters: EpubChapterFile[], model: BookletModel): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(model.meta.identifier)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(model.meta.title)}</text></docTitle>
  <navMap>
    ${chapters
      .map(
        (chapter, index) => `<navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${escapeXml(chapter.fileName)}" />
    </navPoint>`,
      )
      .join("\n")}
  </navMap>
</ncx>
`;
}

function buildEpubContentOpf(chapters: EpubChapterFile[], model: BookletModel): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(model.meta.identifier)}</dc:identifier>
    <dc:title>${escapeXml(model.meta.title)}</dc:title>
    <dc:language>${escapeXml(model.meta.dcLanguage)}</dc:language>
    <dc:creator>${escapeXml(model.meta.creator)}</dc:creator>
    <dc:date>${escapeXml(model.meta.generatedDate)}</dc:date>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
    ${chapters
      .map(
        (chapter) =>
          `<item id="${escapeXml(chapter.id)}" href="${escapeXml(chapter.fileName)}" media-type="application/xhtml+xml" />`,
      )
      .join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((chapter) => `<itemref idref="${escapeXml(chapter.id)}" />`).join("\n    ")}
  </spine>
</package>
`;
}

function buildEpubStyles(): string {
  return `body {
  font-family: "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif;
  line-height: 1.6;
  color: #1e293b;
  margin: 0 1em;
}
h1, h2, h3 {
  color: #0f172a;
}
h2 {
  margin-top: 1.2em;
}
h3 {
  margin-top: 1em;
}
ul, ol {
  padding-left: 1.2em;
}
blockquote {
  border-left: 4px solid #cbd5e1;
  margin: 0.8em 0;
  padding: 0.2em 0.8em;
  color: #334155;
}
.quote-list p {
  margin: 0.4em 0;
}
.quote-ts {
  color: #64748b;
}
`;
}

async function resolveCjkFontPath(): Promise<string | null> {
  for (const candidate of CJK_FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue fallback search.
    }
  }
  return null;
}

async function writeEpubArtifact(filePath: string, model: BookletModel): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "podcasts-to-ebooks-"));
  const oebpsDir = path.join(tempRoot, "OEBPS");
  const metaInfDir = path.join(tempRoot, "META-INF");
  const chapterFiles = buildEpubChapterFiles(model);

  try {
    await fs.writeFile(path.join(tempRoot, "mimetype"), "application/epub+zip", "utf8");
    await fs.mkdir(metaInfDir, { recursive: true });
    await fs.mkdir(oebpsDir, { recursive: true });

    await fs.writeFile(
      path.join(metaInfDir, "container.xml"),
      `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`,
      "utf8",
    );
    await fs.writeFile(path.join(oebpsDir, "styles.css"), buildEpubStyles(), "utf8");
    await fs.writeFile(path.join(oebpsDir, "nav.xhtml"), buildEpubNavXhtml(chapterFiles, model), "utf8");
    await fs.writeFile(path.join(oebpsDir, "toc.ncx"), buildEpubTocNcx(chapterFiles, model), "utf8");
    await fs.writeFile(path.join(oebpsDir, "content.opf"), buildEpubContentOpf(chapterFiles, model), "utf8");
    for (const chapter of chapterFiles) {
      await fs.writeFile(path.join(oebpsDir, chapter.fileName), buildEpubChapterXhtml(chapter, model), "utf8");
    }

    await fs.rm(filePath, { force: true });
    await execFileAsync("zip", ["-X0", filePath, "mimetype"], { cwd: tempRoot });
    await execFileAsync("zip", ["-Xr9D", filePath, "META-INF", "OEBPS"], { cwd: tempRoot });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function sha256Hex(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

async function prepareArtifactFile(params: {
  jobId: string;
  format: OutputFormat;
  booklet: BookletModel;
}): Promise<{ fileName: string; filePath: string; sizeBytes: number; checksum: string }> {
  const fileName = `${params.jobId}.${params.format}`;
  const root = path.resolve(process.cwd(), ".dev-artifacts", params.jobId);
  const filePath = path.join(root, fileName);
  await fs.mkdir(root, { recursive: true });

  if (params.format === "md") {
    await fs.writeFile(filePath, buildMarkdownContent(params.booklet), "utf8");
  } else if (params.format === "pdf") {
    await writePdfArtifact(filePath, params.booklet);
  } else {
    await writeEpubArtifact(filePath, params.booklet);
  }

  const bytes = await fs.readFile(filePath);
  return {
    fileName,
    filePath,
    sizeBytes: bytes.byteLength,
    checksum: sha256Hex(bytes),
  };
}

export async function createArtifacts(params: {
  jobId: string;
  formats: OutputFormat[];
  title: string;
  language: string;
  transcriptText: string;
  templateId: string;
  sourceType: SourceType;
  sourceRef?: string;
  inspector?: (stage: InspectorPushInput) => void;
}) {
  const booklet = await buildBookletModel({
    jobId: params.jobId,
    title: params.title,
    language: params.language,
    transcriptText: params.transcriptText,
    templateId: params.templateId,
    sourceType: params.sourceType,
    sourceRef: params.sourceRef?.trim() || "N/A",
    inspector: params.inspector,
  });

  for (const format of params.formats) {
    if (format === "pdf") {
      const resolvedFont = await resolveCjkFontPath();
      pushInspectorStage(params.inspector, {
        stage: "pdf",
        input: {
          chapter_count: booklet.chapters.length,
          title: booklet.meta.title,
          language: booklet.meta.language,
        },
        config: {
          renderer: "pdfkit",
          cjk_font_resolved: resolvedFont ?? "none",
          margin: 48,
          sections: ["chap_01..chap_14"],
        },
      });
    }

    const built = await prepareArtifactFile({
      jobId: params.jobId,
      format,
      booklet,
    });
    if (format === "pdf") {
      pushInspectorStage(params.inspector, {
        stage: "pdf",
        output: {
          file_name: built.fileName,
          size_bytes: built.sizeBytes,
          checksum_sha256: built.checksum,
        },
      });
    }
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await db.query(
      `INSERT INTO artifacts
         (id, job_id, type, file_name, storage_uri, download_url_last_issued_at, size_bytes, checksum_sha256, expires_at)
       VALUES
         ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
       ON CONFLICT (job_id, type)
       DO UPDATE SET
         file_name = EXCLUDED.file_name,
         storage_uri = EXCLUDED.storage_uri,
         download_url_last_issued_at = EXCLUDED.download_url_last_issued_at,
         size_bytes = EXCLUDED.size_bytes,
         checksum_sha256 = EXCLUDED.checksum_sha256,
         expires_at = EXCLUDED.expires_at`,
      [
        createId("art"),
        params.jobId,
        format,
        built.fileName,
        built.filePath,
        built.sizeBytes,
        built.checksum,
        expiresAt,
      ],
    );
  }
}

export async function listArtifacts(jobId: string): Promise<ArtifactRecord[]> {
  const result = await db.query<{
    type: OutputFormat;
    file_name: string;
    size_bytes: number;
    expires_at: string;
  }>(
    `SELECT type, file_name, size_bytes, expires_at
       FROM artifacts
      WHERE job_id = $1
      ORDER BY type ASC`,
    [jobId],
  );
  return result.rows.map((row: { type: OutputFormat; file_name: string; size_bytes: number; expires_at: string }) => ({
    type: row.type,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    downloadUrl: `${config.publicBaseUrl}/downloads/${jobId}/${encodeURIComponent(row.file_name)}?token=dev`,
    expiresAt: row.expires_at,
  }));
}

export async function getJobInputByJobId(jobId: string): Promise<JobInputRecord | null> {
  const result = await db.query<{
    episode_url: string | null;
    rss_url: string | null;
    metadata: unknown;
  }>(
    `SELECT episode_url, rss_url, metadata
       FROM job_inputs
      WHERE job_id = $1
      LIMIT 1`,
    [jobId],
  );
  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  const row = result.rows[0];
  return {
    episodeUrl: row.episode_url,
    rssUrl: row.rss_url,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function setJobInspectorTrace(jobId: string, stages: InspectorStageRecord[]): Promise<void> {
  await db.query(
    `UPDATE job_inputs
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('inspector_trace', $2::jsonb)
      WHERE job_id = $1`,
    [jobId, JSON.stringify(stages)],
  );
}

export async function getJobInspectorTrace(jobId: string): Promise<InspectorStageRecord[]> {
  const result = await db.query<{ metadata: unknown }>(
    `SELECT metadata
       FROM job_inputs
      WHERE job_id = $1
      LIMIT 1`,
    [jobId],
  );
  if (!result.rowCount || !result.rows[0]) {
    return [];
  }
  const metadata = (result.rows[0].metadata as Record<string, unknown>) ?? {};
  const raw = metadata.inspector_trace;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      stage: String(item.stage ?? "normalization") as InspectorStageName,
      ts: typeof item.ts === "string" ? item.ts : new Date().toISOString(),
      input: typeof item.input === "object" && item.input ? (item.input as Record<string, unknown>) : undefined,
      output: typeof item.output === "object" && item.output ? (item.output as Record<string, unknown>) : undefined,
      config: typeof item.config === "object" && item.config ? (item.config as Record<string, unknown>) : undefined,
      notes: typeof item.notes === "string" ? item.notes : undefined,
    }));
}

export async function getArtifactForDownload(
  jobId: string,
  fileName: string,
): Promise<ArtifactDownloadRecord | null> {
  const result = await db.query<{
    file_name: string;
    storage_uri: string;
    expires_at: string | null;
    type: OutputFormat;
  }>(
    `SELECT file_name, storage_uri, expires_at, type
       FROM artifacts
      WHERE job_id = $1 AND file_name = $2
      LIMIT 1`,
    [jobId, fileName],
  );
  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  return {
    fileName: result.rows[0].file_name,
    storageUri: result.rows[0].storage_uri,
    expiresAt: result.rows[0].expires_at,
    type: result.rows[0].type,
  };
}
