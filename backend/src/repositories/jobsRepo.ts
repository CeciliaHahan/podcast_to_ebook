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
import { generateBookletDraftWithLlm, generateChapterPatchWithLlm, type LlmChapterPatch } from "../services/bookletLlm.js";

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

export type TranscriptSampleSummary = {
  jobId: string;
  title: string;
  language: string;
  createdAt: string;
  charCount: number;
  preview: string;
};

export type TranscriptSampleDetail = TranscriptSampleSummary & {
  transcriptText: string;
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
export type GenerationMethod = "A" | "B" | "C";
type TranscriptSourceProfile = "single" | "interview" | "discussion";
type RenderTemplateProfile = "single-notes-v1" | "interview-notes-v1" | "discussion-roundtable-v1";

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
    const complianceId = createId("cmp");
    await client.query(
      `INSERT INTO compliance_records
         (id, user_id, for_personal_or_authorized_use_only, no_commercial_use, acceptance_copy)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        complianceId,
        input.userId,
        input.compliance.forPersonalOrAuthorizedUseOnly,
        input.compliance.noCommercialUse,
        input.acceptanceCopy,
      ],
    );

    const jobId = createId("job");
    const insertJob = await client.query<{ created_at: string }>(
      `INSERT INTO jobs
         (id, user_id, source_type, status, progress, stage, title, language, template_id,
          output_formats, source_ref, input_char_count,
          compliance_record_id)
       VALUES
         ($1, $2, 'transcript'::source_type, 'queued', 0, 'queued', $3, $4, $5,
          $6::jsonb, $7, $8, $9)
       RETURNING created_at`,
      [
        jobId,
        input.userId,
        input.title ?? null,
        input.language ?? null,
        input.templateId,
        JSON.stringify(input.outputFormats),
        input.sourceRef ?? null,
        input.inputCharCount ?? null,
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
    sourceProfile: TranscriptSourceProfile;
    renderTemplate: RenderTemplateProfile;
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

type ChapterPlanItem = {
  chapterIndex: number;
  title: string;
  range: string;
  segmentIds: string[];
  intent: string;
  startIndex: number;
  endIndex: number;
  signals: string[];
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
const PROFILE_RESOLVED_NAME: Record<TranscriptSourceProfile, string> = {
  single: "single",
  interview: "interview",
  discussion: "discussion",
};
const PROFILE_RENDER_TEMPLATE: Record<TranscriptSourceProfile, RenderTemplateProfile> = {
  single: "single-notes-v1",
  interview: "interview-notes-v1",
  discussion: "discussion-roundtable-v1",
};
const PLACEHOLDER_TOKEN_RE = /\\{[A-Z0-9_]+\\}/g;
const QUESTION_PATTERN = /(\\?|？|想问|请问|我想问|你觉得|你认为|为什么|怎么|what|how|why|which|could|do you|would you)/i;
const DISCUSSION_PATTERNS = /(不同意|反驳|补充|我补充|插话|我来补充|先不急|再想想|你刚才|偏差|误解|我补充)/;
const INTERVIEW_QUERY_MARKERS = /(想听听|你能|我先问|我有个问题|能不能先|接着问|接下来问|继续问|最后再问|主持人|嘉宾|guest)/i;

type ProfileProfileSignals = {
  speakerCount: number;
  turns: number;
  questionRatio: number;
  turnRate: number;
  topSpeakerShare: number;
  interviewSignals: number;
  discussionSignals: number;
};

type TranscriptProfile = {
  sourceProfile: TranscriptSourceProfile;
  confidence: number;
  signals: ProfileProfileSignals;
};

function resolveSpeakerKey(raw: string): string {
  return cleanLine(raw).toLowerCase().replace(/\s+/g, "");
}

function classifyTranscriptSourceProfile(entries: TranscriptEntry[], transcriptText: string): TranscriptProfile {
  const normalizedEntries = entries.filter((entry) => isMeaningfulSentence(entry.text));
  const entryCount = normalizedEntries.length;

  if (entryCount === 0) {
    return {
      sourceProfile: "single",
      confidence: 0.62,
      signals: {
        speakerCount: 1,
        turns: 0,
        questionRatio: 0,
        turnRate: 0,
        topSpeakerShare: 1,
        interviewSignals: 0,
        discussionSignals: 0,
      },
    };
  }

  const speakerCounter = new Map<string, number>();
  const speakersSeen = new Set<string>();
  let turns = 0;
  let previousSpeaker: string | undefined;
  let interviewSignals = 0;
  let discussionSignals = 0;
  let questionCount = 0;

  for (const entry of normalizedEntries) {
    const key = resolveSpeakerKey(entry.speaker || FALLBACK_SPEAKER);
    speakersSeen.add(key);
    speakerCounter.set(key, (speakerCounter.get(key) ?? 0) + 1);
    if (key !== previousSpeaker && previousSpeaker !== undefined) {
      turns += 1;
    }
    previousSpeaker = key;

    if (QUESTION_PATTERN.test(entry.text)) {
      questionCount += 1;
    }
    if (INTERVIEW_QUERY_MARKERS.test(entry.text)) {
      interviewSignals += 1;
    }
    if (DISCUSSION_PATTERNS.test(entry.text)) {
      discussionSignals += 1;
    }
  }

  const questionRatio = questionCount / entryCount;
  const turnRate = turns / Math.max(1, entryCount - 1);
  const speakerCount = Math.max(1, speakersSeen.size);
  const topSpeakerShare = speakerCounter.size === 0 ? 1 : Math.max(...speakerCounter.values()) / entryCount;
  const normalizedInterviewSignals = interviewSignals / entryCount;
  const normalizedDiscussionSignals = discussionSignals / entryCount;
  const bodySignals = extractTranscriptBody(transcriptText).toLowerCase();
  const bodyInterleaveScore = /\n(我|你|他|她|我们|你们|他们)\s*[：:]/g.test(bodySignals) ? 1 : 0.6;

  const scores: Record<TranscriptSourceProfile, number> = {
    single: 1.4 + topSpeakerShare * 2 + Math.max(0, 0.18 - questionRatio) * 2.5 + bodyInterleaveScore * 0.5,
    interview:
      1 + questionRatio * 1.2 + normalizedInterviewSignals * 2.4 + (speakerCount > 1 ? 1.7 : 0) + Math.min(1, topSpeakerShare) * 0.5,
    discussion:
      1.5 +
      turnRate * 3.4 +
      questionRatio * 1.5 +
      normalizedDiscussionSignals * 2.8 +
      Math.min(1, speakerCount / 2) +
      (speakerCount >= 2 ? 1 : 0),
  };

  if (speakerCount <= 1) {
    scores.single += 1.2;
    scores.interview -= 0.8;
    scores.discussion -= 1.1;
  } else if (speakerCount === 2) {
    scores.interview += 0.8;
  } else {
    scores.interview += 1;
    scores.discussion += 1;
  }

  const sorted = (Object.entries(scores) as Array<[TranscriptSourceProfile, number]>).sort((a, b) => b[1] - a[1]);
  const winner = sorted[0];
  const loser = sorted[1];
  const spread = winner[1] - loser[1];
  let confidence = 0.5 + Math.min(0.44, Math.max(0, spread / 3));
  if (entryCount < 12) {
    confidence -= 0.12;
  }
  confidence = Number(Math.max(0.5, Math.min(0.96, confidence)).toFixed(2));

  return {
    sourceProfile: winner[0],
    confidence,
    signals: {
      speakerCount,
      turns,
      questionRatio: Number(questionRatio.toFixed(3)),
      turnRate: Number(turnRate.toFixed(3)),
      topSpeakerShare: Number(topSpeakerShare.toFixed(3)),
      interviewSignals: Number(normalizedInterviewSignals.toFixed(3)),
      discussionSignals: Number(normalizedDiscussionSignals.toFixed(3)),
    },
  };
}

function containsUnresolvedTemplatePlaceholder(value: string): boolean {
  return PLACEHOLDER_TOKEN_RE.test(value);
}

function countModelQualityIssues(model: BookletModel): string[] {
  const issues: string[] = [];
  if (!model.chapters.length) {
    return ["no_chapters"];
  }

  const chapterIds = new Set(model.chapters.map((chapter) => chapter.index));
  const expectedChapterIndices = Array.from({ length: model.chapters.length }, (_, index) => index + 1);
  for (const expected of expectedChapterIndices) {
    if (!chapterIds.has(expected)) {
      issues.push(`missing_chapter_index:${expected}`);
    }
  }

  const expectedSectionIds = new Set<string>(
    model.chapters.map((chapter) => `chap_${String(chapter.index + 3).padStart(2, "0")}`),
  );
  const seenSectionIds = new Set<string>();
  for (const chapter of model.chapters) {
    if (!chapter.title || chapter.title.length < 2) {
      issues.push(`chapter_title_too_short:${chapter.index}`);
    }
    if (!chapter.range) {
      issues.push(`chapter_range_missing:${chapter.index}`);
    }
    if (chapter.points.length < 2) {
      issues.push(`chapter_points_sparse:${chapter.index}`);
    }
    if (chapter.quotes.length < 2) {
      issues.push(`chapter_quotes_sparse:${chapter.index}`);
    }
    if (chapter.actions.length < 1) {
      issues.push(`chapter_actions_missing:${chapter.index}`);
    }
    const expectedSectionId = `chap_${String(chapter.index + 3).padStart(2, "0")}`;
    if (chapter.sectionId !== expectedSectionId) {
      issues.push(`chapter_section_id_mismatch:${chapter.index}`);
    }
    if (seenSectionIds.has(chapter.sectionId)) {
      issues.push(`chapter_section_id_duplicate:${chapter.index}`);
    }
    seenSectionIds.add(chapter.sectionId);
    if (!expectedSectionIds.has(chapter.sectionId)) {
      issues.push(`chapter_section_id_not_indexed:${chapter.index}`);
    }
  }

  if (model.chapters.length < MIN_CHAPTER_COUNT || model.chapters.length > MAX_CHAPTER_COUNT) {
    issues.push(`chapter_count_out_of_range:${model.chapters.length}`);
  }
  if (model.appendixThemes.length < 2) {
    issues.push(`appendix_theme_count_low:${model.appendixThemes.length}`);
  }
  for (const [index, theme] of model.appendixThemes.entries()) {
    if (!theme.name || theme.name.length < 2) {
      issues.push(`appendix_theme_name_missing:${index + 1}`);
    }
    if (!theme.quotes.length) {
      issues.push(`appendix_theme_quotes_missing:${index + 1}`);
    }
  }

  if (!model.meta.title || model.meta.title.length < 4) {
    issues.push("meta_title_missing");
  }
  if (!model.meta.identifier || !model.meta.identifier.startsWith("urn:booklet:")) {
    issues.push("meta_identifier_invalid");
  }
  if (!model.meta.language) {
    issues.push("meta_language_missing");
  }
  if (languageToDc(model.meta.language) !== model.meta.dcLanguage) {
    issues.push("meta_dc_language_mismatch");
  }
  if (!model.meta.generatedAtIso) {
    issues.push("meta_generated_at_missing");
  } else {
    const dateFromIso = model.meta.generatedAtIso.slice(0, 10);
    if (dateFromIso !== model.meta.generatedDate) {
      issues.push(`meta_generated_date_mismatch:${model.meta.generatedDate}/${dateFromIso}`);
    }
  }
  if (!model.meta.sourceType) {
    issues.push("meta_source_type_missing");
  }
  if (!model.meta.sourceRef) {
    issues.push("meta_source_ref_missing");
  }
  if (!model.meta.creator) {
    issues.push("meta_creator_missing");
  }

  const actualSections = model.chapters.length + 7;
  if (actualSections < 12 || actualSections > 14) {
    issues.push(`template_section_count_unexpected:${actualSections}`);
  }
  if (model.suitableFor.length < 2) {
    issues.push(`suitable_for_too_short:${model.suitableFor.length}`);
  }
  if (model.outcomes.length < 2) {
    issues.push(`outcomes_too_short:${model.outcomes.length}`);
  }
  if (!model.oneLineConclusion) {
    issues.push("one_line_conclusion_missing");
  }
  if (model.tldr.length < 3) {
    issues.push(`tldr_too_short:${model.tldr.length}`);
  }
  if (model.tldr.length > 10) {
    issues.push(`tldr_too_long:${model.tldr.length}`);
  }
  if (model.terms.length < 2) {
    issues.push(`terms_too_few:${model.terms.length}`);
  }
  if ((model.actionNow.length + model.actionWeek.length + model.actionLong.length) < 4) {
    issues.push("actions_total_too_few");
  }

  const flatText = [
    model.meta.title,
    model.meta.sourceType,
    model.meta.sourceRef,
    ...model.suitableFor,
    ...model.outcomes,
    model.oneLineConclusion,
    ...model.tldr,
    ...model.actionNow,
    ...model.actionWeek,
    ...model.actionLong,
    ...model.terms.map((term) => `${term.term} ${term.definition}`),
    ...model.appendixThemes.flatMap((theme) => [theme.name, ...theme.quotes.map((quote) => `${quote.speaker} ${quote.timestamp} ${quote.text}`)]),
      ...model.chapters.flatMap((chapter) => [
      chapter.title,
      chapter.range,
      ...chapter.points,
      ...chapter.quotes.map((quote) => `${quote.speaker} ${quote.timestamp} ${quote.text}`),
      chapter.explanation.background,
      chapter.explanation.commonMisunderstanding,
      chapter.explanation.coreConcept,
      chapter.explanation.judgmentFramework,
      ...chapter.actions,
    ]),
  ];

  if (flatText.some((text) => containsUnresolvedTemplatePlaceholder(text))) {
    issues.push("unresolved_template_token");
  }
  return issues;
}
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
};
const FULL_BOOK_LLM_MAX_CHARS = 32_000;
const PROFILE_MERGE_CAPS: Record<TranscriptSourceProfile, typeof MERGE_CAPS> = {
  single: {
    ...MERGE_CAPS,
    suitableFor: 5,
    chapterPoints: 5,
    terms: 5,
  },
  interview: {
    ...MERGE_CAPS,
    chapterPoints: 4,
    chapterActions: 3,
    tldr: 6,
    suitableFor: 4,
    terms: 4,
  },
  discussion: {
    ...MERGE_CAPS,
    chapterPoints: 4,
    chapterActions: 3,
    suitableFor: 4,
    terms: 6,
  },
};
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
const QUALITY_GATE_BLOCKING_PREFIXES: string[] = [
  "chapter_count_out_of_range",
  "template_section_count_unexpected",
  "meta_identifier_invalid",
  "meta_language_missing",
  "meta_dc_language_mismatch",
  "meta_generated_at_missing",
  "meta_generated_date_mismatch",
  "meta_source_type_missing",
  "meta_source_ref_missing",
  "meta_creator_missing",
  "appendix_theme_count_low",
  "appendix_theme_name_missing",
  "appendix_theme_quotes_missing",
  "no_chapters",
  "chapter_title_too_short",
  "chapter_range_missing",
  "chapter_section_id_mismatch",
  "chapter_section_id_duplicate",
  "chapter_section_id_not_indexed",
  "missing_chapter_index",
];
const QUALITY_GATE_WARNING_PREFIXES: string[] = [
  "suitable_for_too_short",
  "outcomes_too_short",
  "tldr_too_short",
  "tldr_too_long",
  "terms_too_few",
  "actions_total_too_few",
  "chapter_points_sparse",
  "chapter_quotes_sparse",
  "chapter_actions_missing",
  "one_line_conclusion_missing",
];
const QUALITY_GATE_WARNING_MAX = 4;

function isQualityGateBlockingIssue(issue: string): boolean {
  return QUALITY_GATE_BLOCKING_PREFIXES.some((prefix) => issue.startsWith(prefix));
}

function isQualityGateWarning(issue: string): boolean {
  return QUALITY_GATE_WARNING_PREFIXES.some((prefix) => issue.startsWith(prefix));
}

function isQualityGatePassed(issues: string[]): {
  passed: boolean;
  blockingIssues: string[];
  warningIssues: string[];
  warningCount: number;
} {
  const blockingIssues = issues.filter(isQualityGateBlockingIssue);
  const warningIssues = issues.filter(isQualityGateWarning);
  return {
    passed: blockingIssues.length === 0 && warningIssues.length <= QUALITY_GATE_WARNING_MAX,
    blockingIssues,
    warningIssues,
    warningCount: warningIssues.length,
  };
}

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

function stripTrailingEllipsis(input: string): string {
  return input.replace(/(\.\.\.|…)+$/g, "").trim();
}

function normalizeSummarySentence(input: string): string {
  const cleaned = stripTrailingEllipsis(
    cleanLine(input)
      .replace(/^第\s*\d+\s*章(?:聚焦)?\s*[：:，,\-\s]*/i, "")
      .replace(/^\d+\s*[.)、]\s*/, "")
      .replace(/^要点\s*\d+\s*[：:\-]?\s*/i, ""),
  );
  if (!cleaned) {
    return "";
  }
  if (/[。！？!?]$/.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}。`;
}

function isGreetingLikeTitle(input: string): boolean {
  const normalized = cleanLine(input).toLowerCase();
  if (!normalized) {
    return false;
  }
  return /(hello|hi|大家好|欢迎收听|我是|在你听这期|想跟大家说|本期节目|先跟大家说|newsletter|订阅)/i.test(normalized);
}

function createProfileFallbackTitle(profile: TranscriptSourceProfile, keywords: string[]): string {
  const picks = pickHighSignalTitleKeywords(keywords, 3);
  if (profile === "discussion" && picks.length) {
    return `圆桌讨论：${picks.join(" / ")}`;
  }
  if (profile === "interview" && picks.length) {
    return `访谈纪要：${picks.join(" / ")}`;
  }
  if (profile === "single" && picks.length) {
    return `主题笔记：${picks.join(" / ")}`;
  }
  if (profile === "discussion") {
    return "圆桌讨论纪要";
  }
  if (profile === "interview") {
    return "访谈纪要";
  }
  return "主题笔记";
}

function isLowInformationTitle(input: string): boolean {
  const normalized = cleanLine(input)
    .replace(/^圆桌讨论[：:]\s*/i, "")
    .replace(/^访谈纪要[：:]\s*/i, "")
    .replace(/^主题笔记[：:]\s*/i, "");
  const tokens = normalized
    .split(/[\/|、,，\s]+/)
    .map((token) => normalizeTopicKeywordToken(token))
    .filter(Boolean);
  if (!tokens.length) {
    return true;
  }
  const highSignal = tokens.filter((token) => !isLowSignalTitleKeyword(token));
  if (!highSignal.length) {
    return true;
  }
  if (tokens.length >= 2 && highSignal.length <= 1 && normalized.length <= 24) {
    return true;
  }
  return false;
}

function resolveBookletTitle(rawTitle: string, profile: TranscriptSourceProfile, keywords: string[]): string {
  const cleaned = cleanLine(rawTitle).replace(/[\\*_`~]/g, "").trim();
  if (!cleaned) {
    return createProfileFallbackTitle(profile, keywords);
  }
  if (cleaned.length > 42) {
    return createProfileFallbackTitle(profile, keywords);
  }
  if (isGreetingLikeTitle(cleaned)) {
    return createProfileFallbackTitle(profile, keywords);
  }
  if (/[，。！？?!]/.test(cleaned) && cleaned.length > 28) {
    return createProfileFallbackTitle(profile, keywords);
  }
  if (isLowInformationTitle(cleaned)) {
    return createProfileFallbackTitle(profile, keywords);
  }
  return cleaned;
}

function buildDiscussionSummaryFromBodyChapters(bodyChapters: RenderChapterView[]): string[] {
  const summaries = uniqueNonEmpty(
    bodyChapters
      .map((item) => {
        const corePoint = item.chapter.points.find((point) => point.length >= 10) ?? item.chapter.points[0] ?? item.chapter.title;
        return normalizeSummarySentence(`${item.chapter.title}：${corePoint}`);
      })
      .filter(Boolean),
  );
  return summaries.length ? summaries : ["本期讨论聚焦多条争议轴，需要结合正文逐章阅读。"];
}

function buildTldrFromChapters(
  chapters: BookletChapter[],
  profile: TranscriptSourceProfile,
  fallbackKeywords: string[],
): string[] {
  const direct = uniqueNonEmpty(
    chapters
      .map((chapter) => {
        const corePoint = chapter.points.find((point) => point.length >= 8) ?? chapter.points[0] ?? chapter.title;
        if (profile === "discussion") {
          return normalizeSummarySentence(`${chapter.title}：${corePoint}`);
        }
        return normalizeSummarySentence(corePoint);
      })
      .filter(Boolean),
  );
  const fallbackTopic = fallbackKeywords.filter(Boolean).slice(0, 3).join("、") || "本期核心议题";
  return fillToCount(
    direct.slice(0, 7),
    7,
    (index) => normalizeSummarySentence(`围绕${fallbackTopic}展开的关键判断 ${index + 1}`),
  );
}

function normalizeModelTldr(
  current: string[],
  chapters: BookletChapter[],
  profile: TranscriptSourceProfile,
  fallbackKeywords: string[],
): string[] {
  const cleanedCurrent = uniqueNonEmpty(current.map((item) => normalizeSummarySentence(item)).filter(Boolean));
  const fallback = buildTldrFromChapters(chapters, profile, fallbackKeywords);
  return fillToCount(
    cleanedCurrent.slice(0, 7),
    7,
    (index) => fallback[index] ?? normalizeSummarySentence(`围绕本期主题的关键判断 ${index + 1}`),
  );
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
  "hello",
  "welcome",
  "speaker",
  "host",
  "guest",
  "yeah",
  "right",
  "okay",
]);
const DISCOURSE_FILLERS = new Set([
  "对吧",
  "没错",
  "是的",
  "然后",
  "就是",
  "其实",
  "那个",
  "这个",
  "我们",
  "你们",
  "他们",
  "大家",
  "好的",
  "嗯",
  "啊",
  "呃",
  "诶",
  "哈哈",
  "哈哈哈",
  "的话",
  "这种",
  "这样",
  "那个时候",
  "然后呢",
]);

const GENERIC_DECLARED_KEYWORDS = new Set(["世界", "电影", "故事", "时代", "身份", "人类", "节目", "文化"]);
const GENERIC_TITLE_KEYWORDS = new Set([
  ...GENERIC_DECLARED_KEYWORDS,
  "问题",
  "事情",
  "这件事",
  "这件事情",
  "件事情",
  "东西",
  "内容",
  "讨论",
  "观点",
  "结论",
  "目录",
  "议题",
  "交媒体",
]);

const TITLE_NOISE_PHRASES = new Set([
  "好莱坞它",
  "没有办法",
  "没办法",
  "没有可能",
  "这件事",
  "这件事情",
  "件事情",
  "这个事情",
  "那个事情",
  "交媒体",
]);

const TITLE_LEADING_NOISE = [
  "关于",
  "对于",
  "如果",
  "但是",
  "而且",
  "并且",
  "然后",
  "其实",
  "就是",
  "因为",
  "所以",
  "还是",
  "这个",
  "那个",
  "这种",
  "那种",
  "我们",
  "你们",
  "他们",
];

const TITLE_TRAILING_NOISE = [
  "这个",
  "那个",
  "这样",
  "那样",
  "我们",
  "你们",
  "他们",
  "它们",
  "自己",
  "一下",
  "出来",
  "进去",
  "可以",
  "应该",
  "需要",
  "没有",
  "办法",
  "其实",
  "就是",
  "然后",
  "事情",
  "东西",
  "内容",
];

const TITLE_EDGE_NOISE_CHARS = new Set([
  "们",
  "个",
  "些",
  "这",
  "那",
  "其",
  "的",
  "了",
  "得",
  "地",
  "在",
  "与",
  "和",
  "就",
  "都",
  "还",
  "也",
  "被",
  "把",
  "有",
  "没",
  "不",
  "他",
  "她",
  "它",
  "你",
  "我",
  "吗",
  "呢",
  "吧",
  "啊",
  "呀",
  "嘛",
]);

function trimTopicKeywordNoiseEdges(input: string): string {
  let out = input;
  let changed = true;
  while (changed && out.length >= 2) {
    changed = false;
    for (const prefix of TITLE_LEADING_NOISE) {
      if (out.startsWith(prefix) && out.length - prefix.length >= 2) {
        out = out.slice(prefix.length);
        changed = true;
      }
    }
    for (const suffix of TITLE_TRAILING_NOISE) {
      if (out.endsWith(suffix) && out.length - suffix.length >= 2) {
        out = out.slice(0, out.length - suffix.length);
        changed = true;
      }
    }
    if (/[它他她你我吗呢吧呀啊嘛了的得]$/.test(out) && out.length >= 3) {
      out = out.slice(0, -1);
      changed = true;
    }
    const chars = Array.from(out);
    if (chars.length >= 3 && TITLE_EDGE_NOISE_CHARS.has(chars[0] as string)) {
      out = chars.slice(1).join("");
      changed = true;
    }
    const outChars = Array.from(out);
    if (outChars.length >= 3 && TITLE_EDGE_NOISE_CHARS.has(outChars[outChars.length - 1] as string)) {
      out = outChars.slice(0, -1).join("");
      changed = true;
    }
  }
  return out;
}

function normalizeTopicKeywordToken(token: string): string {
  const cleaned = cleanLine(token)
    .replace(/[“”"']/g, "")
    .replace(/^第\s*\d+\s*章(?:聚焦)?\s*[：:，,\-\s]*/i, "")
    .replace(/：?\s*核心讨论$/i, "")
    .replace(/^[^\p{Script=Han}A-Za-z0-9]+/gu, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9]+$/gu, "");
  return trimTopicKeywordNoiseEdges(cleaned);
}

function dedupeOverlappingTopicKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  for (const rawKeyword of keywords) {
    const keyword = normalizeTopicKeywordToken(rawKeyword);
    if (!keyword) {
      continue;
    }
    let handled = false;
    for (let index = 0; index < out.length; index += 1) {
      const current = out[index] as string;
      if (current === keyword) {
        handled = true;
        break;
      }
      if (current.length >= keyword.length + 1 && current.includes(keyword)) {
        handled = true;
        break;
      }
      if (keyword.length >= current.length + 1 && keyword.includes(current)) {
        out[index] = keyword;
        handled = true;
        break;
      }
    }
    if (!handled) {
      out.push(keyword);
    }
  }
  return uniqueNonEmpty(out);
}

function isLowSignalTitleKeyword(keyword: string): boolean {
  const normalized = normalizeTopicKeywordToken(keyword);
  if (!normalized || normalized.length < 2) {
    return true;
  }
  if (TITLE_NOISE_PHRASES.has(normalized)) {
    return true;
  }
  if (GENERIC_TITLE_KEYWORDS.has(normalized) || isLowSignalKeywordToken(normalized)) {
    return true;
  }
  if (/^(没有|没法|无法|可以|应该|需要|觉得|希望|想要)/.test(normalized)) {
    return true;
  }
  if (/^(没有办|没办法|应该|可以|需要|不是|就是|其实|然后)$/.test(normalized)) {
    return true;
  }
  if (/^(些|把|将|让)/.test(normalized)) {
    return true;
  }
  if (/(转|成|做|说|看|想|要|会|能|该)$/.test(normalized)) {
    return true;
  }
  if (/^(这个|那个|这种|那种)/.test(normalized) && normalized.length <= 4) {
    return true;
  }
  if (/(办法|事情|东西|内容|问题)$/.test(normalized) && normalized.length <= 4) {
    return true;
  }
  if (/[它他她你我其]$/.test(normalized)) {
    return true;
  }
  if (/^(第\d+章|核心讨论|主题\d+)$/.test(normalized)) {
    return true;
  }
  return false;
}

function defaultDiscussionFallbackTitle(index: number, preferredKeywords: string[]): { title: string; topicKeywords: string[] } {
  const safePreferred = dedupeOverlappingTopicKeywords(preferredKeywords)
    .filter((keyword) => !isLowSignalTitleKeyword(keyword))
    .slice(0, 1);
  if (safePreferred.length) {
    return { title: `${safePreferred[0]}：延展讨论`, topicKeywords: safePreferred };
  }
  return { title: `核心讨论 ${index}`, topicKeywords: [] };
}

function isRelatedToPreferredKeyword(candidate: string, preferredKeywords: string[]): boolean {
  const normalizedCandidate = normalizeTopicKeywordToken(candidate);
  if (!normalizedCandidate) {
    return false;
  }
  return preferredKeywords.some((keyword) => {
    const normalized = normalizeTopicKeywordToken(keyword);
    if (!normalized) {
      return false;
    }
    return normalizedCandidate.includes(normalized) || normalized.includes(normalizedCandidate);
  });
}

function pickHighSignalTitleKeywords(keywords: string[], count: number): string[] {
  return dedupeOverlappingTopicKeywords(keywords)
    .filter((keyword) => !isLowSignalTitleKeyword(keyword))
    .slice(0, count);
}

function splitTopicKeywordHints(input: string): string[] {
  return cleanLine(input)
    .split(/[\/|、,，;；：:\s]+/)
    .map((part) => normalizeTopicKeywordToken(part))
    .filter((part) => part.length >= 2);
}

function canonicalizeTopicKeywordWithHints(keyword: string, hintKeywords: string[]): string {
  const normalized = normalizeTopicKeywordToken(keyword);
  if (!normalized) {
    return "";
  }

  const hints = dedupeOverlappingTopicKeywords(hintKeywords)
    .map((hint) => normalizeTopicKeywordToken(hint))
    .filter((hint) => hint.length >= 2)
    .filter((hint) => !isLowSignalTitleKeyword(hint));
  if (!hints.length) {
    return normalized;
  }
  if (hints.includes(normalized)) {
    return normalized;
  }

  const containerHint = hints
    .filter((hint) => hint.length >= normalized.length + 1 && hint.includes(normalized))
    .sort((a, b) => a.length - b.length)[0];
  if (containerHint && containerHint.length <= normalized.length + 2) {
    return containerHint;
  }

  const containedHint = hints
    .filter((hint) => normalized.length >= hint.length + 1 && normalized.includes(hint) && hint.length >= 3)
    .sort((a, b) => b.length - a.length)[0];
  if (containedHint && normalized.length <= containedHint.length + 1) {
    return containedHint;
  }
  return normalized;
}

function normalizeTopicKeywordListWithHints(keywords: string[], hintKeywords: string[]): string[] {
  return dedupeOverlappingTopicKeywords(
    keywords
      .map((keyword) => canonicalizeTopicKeywordWithHints(keyword, hintKeywords))
      .filter(Boolean),
  ).filter((keyword) => !isLowSignalKeywordToken(keyword));
}

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

function extractDeclaredKeywords(input: string): string[] {
  const match = input.match(/keywords\s*:\s*([\s\S]*?)\btranscript\s*:/i);
  if (!match?.[1]) {
    return [];
  }
  return uniqueNonEmpty(
    match[1]
      .replace(/\s+/g, " ")
      .split(/[、,，;；|/]/)
      .map((part) => normalizeTopicKeywordToken(part))
      .filter((part) => part.length >= 2)
      .filter((part) => !isLowSignalKeywordToken(part)),
  );
}

function isLowSignalKeywordToken(token: string): boolean {
  if (!token || token.length < 2) {
    return true;
  }
  const normalized = /[A-Za-z]/.test(token) ? token.toLowerCase() : token;
  if (
    CJK_STOPWORDS.has(normalized) ||
    NOISE_KEYWORDS.has(normalized) ||
    EN_STOPWORDS.has(normalized) ||
    DISCOURSE_FILLERS.has(normalized)
  ) {
    return true;
  }
  if (/^(对+|嗯+|啊+|呃+|诶+|哈+|ok+|okay+|yeah+)$/.test(normalized)) {
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    return true;
  }
  if (/^speaker\d*$/i.test(normalized)) {
    return true;
  }
  if (/^([\u4e00-\u9fffA-Za-z])\1{2,}$/.test(normalized)) {
    return true;
  }
  if (/^(交媒体|件事情|这件事情|那个事情|这个事情)$/.test(normalized)) {
    return true;
  }
  if (
    /^(但是|时候|的时候|然后|就是|对吧|没错|是的|好了|谢谢你|拜拜|我们|你们|他们|大家|是一个|的一个|我觉得|你觉得|事情|东西)$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function extractKeywords(input: string): string[] {
  const hanDominant = (input.match(/[\u4e00-\u9fff]/g) ?? []).length >= 30;
  const chunks = input.match(/[\p{Script=Han}]+|[A-Za-z]{4,}/gu) ?? [];
  const scored = new Map<string, number>();

  const grammarChars = new Set(["的", "了", "是", "在", "就", "都", "和", "与", "及", "而", "但", "并", "被"]);
  const isHanTokenCandidate = (token: string): boolean => {
    if (token.length < 2 || token.length > 6) {
      return false;
    }
    if (isLowSignalKeywordToken(token)) {
      return false;
    }
    const chars = Array.from(token);
    const grammarCount = chars.filter((char) => grammarChars.has(char)).length;
    if (grammarCount >= Math.ceil(chars.length / 2)) {
      return false;
    }
    if (/^(这个|那个|一种|一些|一个|什么|怎么|因为|所以|然后|不是|没有|我觉得|你觉得|是一个|的一个)$/.test(token)) {
      return false;
    }
    if (/^(对吧|没错|是的|哈哈|好的|拜拜|谢谢|时候)$/.test(token)) {
      return false;
    }
    if (/^(我|你|他|她|它|我们|你们|他们)/.test(token) && token.length <= 4) {
      return false;
    }
    if (grammarChars.has(token[0] ?? "") || grammarChars.has(token[token.length - 1] ?? "")) {
      return false;
    }
    return true;
  };

  for (const chunkRaw of chunks) {
    if (!chunkRaw.trim()) {
      continue;
    }
    if (/[A-Za-z]/.test(chunkRaw)) {
      const token = chunkRaw.toLowerCase();
      if (hanDominant || isLowSignalKeywordToken(token)) {
        continue;
      }
      scored.set(token, (scored.get(token) ?? 0) + 1);
      continue;
    }

    const chunk = chunkRaw.trim();
    if (chunk.length < 2) {
      continue;
    }
    for (let size = 2; size <= 4; size += 1) {
      if (chunk.length < size) {
        continue;
      }
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const token = chunk.slice(index, index + size);
        if (!isHanTokenCandidate(token)) {
          continue;
        }
        const weight = size === 4 ? 2.2 : size === 3 ? 1.6 : 1;
        scored.set(token, (scored.get(token) ?? 0) + weight);
      }
    }
  }

  const ranked = Array.from(scored.entries())
    .filter(([token, count]) => !isLowSignalKeywordToken(token) && count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const highConfidence = ranked.filter(([, count]) => count >= 4);
  const selected = (highConfidence.length >= 3 ? highConfidence : ranked).map(([token]) => token);
  return uniqueNonEmpty(selected);
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

function keywordFrequency(text: string, keyword: string): number {
  if (!text || !keyword) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (cursor >= 0) {
    const index = text.indexOf(keyword, cursor);
    if (index === -1) {
      break;
    }
    count += 1;
    cursor = index + keyword.length;
  }
  return count;
}

function chapterTitleFromChunk(
  index: number,
  chunk: TranscriptEntry[],
  preferredKeywords: string[],
): { title: string; topicKeywords: string[] } {
  const chunkText = chunk.map((entry) => entry.text).join(" ");
  const preferredHits = dedupeOverlappingTopicKeywords(
    preferredKeywords
      .map((keyword) => ({ keyword: normalizeTopicKeywordToken(keyword), score: keywordFrequency(chunkText, keyword) }))
      .filter((item) => item.keyword && item.score > 0)
      .sort((a, b) => b.score - a.score || b.keyword.length - a.keyword.length)
      .map((item) => item.keyword),
  )
    .filter((keyword) => !isLowSignalTitleKeyword(keyword))
    .slice(0, 3);
  if (preferredHits.length >= 2) {
    return { title: preferredHits.slice(0, 2).join(" / "), topicKeywords: preferredHits };
  }
  if (preferredHits.length === 1) {
    return { title: `${preferredHits[0]}：核心讨论`, topicKeywords: preferredHits };
  }

  const keywords = dedupeOverlappingTopicKeywords(topicFocusKeywords(extractKeywords(chunkText), 6))
    .filter((keyword) => !isLowSignalTitleKeyword(keyword))
    .filter((keyword) => isRelatedToPreferredKeyword(keyword, preferredKeywords))
    .slice(0, 3);
  if (!keywords.length) {
    return defaultDiscussionFallbackTitle(index, preferredKeywords);
  }
  if (keywords.length === 1) {
    return { title: `${keywords[0]}：核心讨论`, topicKeywords: keywords };
  }
  return { title: keywords.slice(0, 2).join(" / "), topicKeywords: keywords };
}

function buildChapterPlan(
  entries: TranscriptEntry[],
  segments: SemanticSegment[],
  preferredKeywords: string[],
): ChapterPlanItem[] {
  return segments.map((segment, index) => {
    const chapterIndex = index + 1;
    const chunk = entries.slice(segment.startIndex, segment.endIndex + 1);
    const titleMatch = chapterTitleFromChunk(chapterIndex, chunk, preferredKeywords);
    const intent = segment.signals.includes("question_turn") ? "question-driven-analysis" : "summarize-and-apply";
    return {
      chapterIndex,
      title: titleMatch.title,
      range: toRange(chunk),
      segmentIds: [`seg_${String(chapterIndex).padStart(2, "0")}`],
      intent,
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      signals: segment.signals,
      topicKeywords: titleMatch.topicKeywords,
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

function chapterActionsFromPoints(points: string[]): string[] {
  const first = shorten(points[0] ?? "选出本章最关键观点", 28);
  const second = shorten(points[1] ?? "补齐这一观点的证据链", 28);
  return [
    `把“${first}”改写成 3 步执行清单，并设定截止时间。`,
    `从本章引用中挑 1 条证据，验证“${second}”是否成立。`,
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

function topicFocusKeywords(keywords: string[], count: number): string[] {
  return dedupeOverlappingTopicKeywords(keywords)
    .filter((keyword) => !isLowSignalKeywordToken(keyword))
    .slice(0, count);
}

function buildSuitableFor(topics: string[]): string[] {
  const topicPhrase = topics.length ? topics.join("、") : "本期核心议题";
  return [
    `关注${topicPhrase}、想理解背后社会语境的听众。`,
    "想把播客观点沉淀成可复盘笔记，而不是只停留在“听过了”的人。",
    "希望把灵感转成可执行行动，并持续验证效果的人。",
  ];
}

function findTermEvidenceSnippet(term: string, chapters: BookletChapter[]): string {
  for (const chapter of chapters) {
    const pointHit = chapter.points.find((point) => point.includes(term));
    if (pointHit) {
      return shorten(pointHit, 52);
    }
    const quoteHit = chapter.quotes.find((quote) => quote.text.includes(term));
    if (quoteHit) {
      return shorten(quoteHit.text, 52);
    }
  }
  return "";
}

function buildTermsFromKeywords(keywords: string[], chapters: BookletChapter[], hintKeywords: string[] = []): BookletTerm[] {
  const chapterTopicHints = dedupeOverlappingTopicKeywords(chapters.flatMap((chapter) => splitTopicKeywordHints(chapter.title)));
  const normalizedKeywords = normalizeTopicKeywordListWithHints(keywords, [...hintKeywords, ...chapterTopicHints]);
  const topicTerms = topicFocusKeywords(normalizedKeywords, 6);
  if (!topicTerms.length) {
    return fillToCount(
      [],
      3,
      (index) =>
        ({
          term: `术语 ${index + 1}`,
          definition: "本期反复出现的重要概念，用于支撑核心观点。",
        }) satisfies BookletTerm,
    );
  }
  return fillToCount(
    topicTerms.map((term) => {
      const snippet = findTermEvidenceSnippet(term, chapters);
      return {
        term,
        definition: snippet
          ? `节目语境：${snippet}`
          : `节目中围绕“${term}”展开讨论，强调其与主题判断和行动选择的关系。`,
      };
    }),
    3,
    (index) => {
      const fallbackTerm = topicTerms[index % topicTerms.length] ?? `术语 ${index + 1}`;
      return {
        term: fallbackTerm,
        definition: `节目中围绕“${fallbackTerm}”展开讨论，强调其与主题判断和行动选择的关系。`,
      };
    },
  );
}

function buildChapterPatchTranscriptExcerpt(chunk: TranscriptEntry[], maxChars = 5400): string {
  const rows = chunk.map((entry) => `${entry.speaker} ${entry.timestamp}\n${entry.text}`);
  let joined = "";
  for (const row of rows) {
    if (joined.length + row.length + 2 > maxChars) {
      break;
    }
    joined += joined ? `\n\n${row}` : row;
  }
  return joined || rows.slice(0, 3).join("\n\n");
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

function mergeBookletWithChapterPatches(
  base: BookletModel,
  chapterPatches: Map<number, LlmChapterPatch>,
  mergeCaps: typeof MERGE_CAPS,
): BookletModel {
  if (!chapterPatches.size) {
    return base;
  }
  return {
    ...base,
    chapters: base.chapters.map((chapter) => {
      const patch = chapterPatches.get(chapter.index);
      if (!patch) {
        return chapter;
      }
      return {
        ...chapter,
        points: chooseListWithFallback(patch.points, chapter.points, mergeCaps.chapterPoints, 120),
        explanation: {
          background: cleanBookletField(patch.explanation.background || chapter.explanation.background, 220) ||
            chapter.explanation.background,
          coreConcept: cleanBookletField(patch.explanation.coreConcept || chapter.explanation.coreConcept, 220) ||
            chapter.explanation.coreConcept,
          judgmentFramework:
            cleanBookletField(patch.explanation.judgmentFramework || chapter.explanation.judgmentFramework, 220) ||
            chapter.explanation.judgmentFramework,
          commonMisunderstanding:
            cleanBookletField(
              patch.explanation.commonMisunderstanding || chapter.explanation.commonMisunderstanding,
              220,
            ) || chapter.explanation.commonMisunderstanding,
        },
        actions: chooseListWithFallback(patch.actions, chapter.actions, mergeCaps.chapterActions, 120),
      };
    }),
  };
}

function mergeBookletWithLlmDraft(
  base: BookletModel,
  draft: Awaited<ReturnType<typeof generateBookletDraftWithLlm>>,
  evidence: QuoteEvidenceIndex,
  chapterEvidenceMap: ChapterEvidenceMap,
  mergeCaps: typeof MERGE_CAPS,
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
      points: chooseListWithFallback(draftChapter.points, chapter.points, mergeCaps.chapterPoints, 120),
      quotes: chooseQuoteListWithFallback(draftChapter.quotes, chapter.quotes, mergeCaps.chapterQuotes, chapterEvidence),
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
      actions: chooseListWithFallback(draftChapter.actions, chapter.actions, mergeCaps.chapterActions, 120),
    };
  });

  const actionFallback = chapters.flatMap((chapter) => chapter.actions);
  const mergedAppendixThemes = draft.appendixThemes
    .slice(0, mergeCaps.appendixThemes)
    .map((theme, index) => ({
      name: cleanBookletField(theme.name, 40) || `主题 ${index + 1}`,
      quotes: chooseQuoteListWithFallback(
        theme.quotes,
        base.appendixThemes[index]?.quotes ?? base.appendixThemes[0]?.quotes ?? [],
        mergeCaps.appendixThemeQuotes,
        evidence,
      ),
    }));

  return {
    ...base,
    suitableFor: chooseListWithFallback(draft.suitableFor, base.suitableFor, mergeCaps.suitableFor, 120),
    outcomes: chooseListWithFallback(draft.outcomes, base.outcomes, mergeCaps.outcomes, 120),
    oneLineConclusion:
      cleanBookletField(draft.oneLineConclusion || base.oneLineConclusion, 180) || base.oneLineConclusion,
    tldr: chooseListWithFallback(
      draft.tldr,
      base.tldr,
      mergeCaps.tldr,
      180,
      (index) => base.tldr[index] ?? `要点 ${index + 1}`,
    ),
    chapters,
    actionNow: chooseListWithFallback(draft.actionNow, actionFallback.slice(0, 3), mergeCaps.actionNow, 120),
    actionWeek: chooseListWithFallback(draft.actionWeek, actionFallback.slice(3, 6), mergeCaps.actionWeek, 120),
    actionLong: chooseListWithFallback(draft.actionLong, actionFallback.slice(6, 8), mergeCaps.actionLong, 120),
    terms:
      draft.terms.length >= mergeCaps.draftTermsMin
        ? draft.terms.slice(0, mergeCaps.terms).map((term) => ({
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
  generationMethod?: GenerationMethod;
  sourceProfile?: TranscriptProfile;
  inspector?: (stage: InspectorPushInput) => void;
}): Promise<BookletModel> {
  const entries = parseTranscriptEntries(params.transcriptText);
  const transcriptBody = extractTranscriptBody(params.transcriptText);
  const declaredKeywords = extractDeclaredKeywords(params.transcriptText);
  const rankedDeclaredKeywords = declaredKeywords
    .map((keyword) => ({ keyword, score: keywordFrequency(transcriptBody, keyword) }))
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .map((item) => item.keyword);
  const prioritizedDeclaredKeywords = rankedDeclaredKeywords.filter((keyword) => !GENERIC_DECLARED_KEYWORDS.has(keyword));
  const chapterTitleKeywords = prioritizedDeclaredKeywords.length ? prioritizedDeclaredKeywords : rankedDeclaredKeywords;
  const sourceProfile = params.sourceProfile ?? classifyTranscriptSourceProfile(entries, params.transcriptText);
  const mergeCaps = PROFILE_MERGE_CAPS[sourceProfile.sourceProfile];
  const plannedSegments = planSemanticSegments(entries);
  const chapterPlan = buildChapterPlan(entries, plannedSegments, chapterTitleKeywords);
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
      actions: chapterActionsFromPoints(points),
    };
  });

  const keywordSource = entries.map((entry) => entry.text).join("\n") || transcriptBody;
  const anchorKeywords = topicFocusKeywords([...chapterTitleKeywords, ...rankedDeclaredKeywords], 8);
  const discoveredKeywords = topicFocusKeywords(extractKeywords(keywordSource), 10);
  const topKeywords = topicFocusKeywords(
    normalizeTopicKeywordListWithHints([...anchorKeywords, ...discoveredKeywords], anchorKeywords),
    6,
  );
  const focusKeywords = topicFocusKeywords(topKeywords, 3);
  const renderTemplate = PROFILE_RENDER_TEMPLATE[sourceProfile.sourceProfile];
  const resolvedTitle = resolveBookletTitle(
    params.title,
    sourceProfile.sourceProfile,
    uniqueNonEmpty([...rankedDeclaredKeywords, ...topKeywords]),
  );
  const tldr = buildTldrFromChapters(chapters, sourceProfile.sourceProfile, topKeywords);
  const terms = buildTermsFromKeywords(topKeywords, chapters, anchorKeywords);

  const generatedAtIso = new Date().toISOString();
  const generatedDate = generatedAtIso.slice(0, 10);
  const quotePool = chapters.flatMap((chapter) => chapter.quotes).slice(0, 4);
  const appendixQuotes = fillToCount(quotePool, 4, (index) => ({
    speaker: FALLBACK_SPEAKER,
    timestamp: FALLBACK_TIMESTAMP,
    text: tldr[index] ?? "将听到的观点转化成行动，才会形成沉淀。",
  }));

  const baseModel: BookletModel = {
    meta: {
      identifier: `urn:booklet:${params.jobId}`,
      title: resolvedTitle,
      language: params.language,
      dcLanguage: languageToDc(params.language),
      creator: BOOK_CREATOR,
      generatedAtIso,
      generatedDate,
      sourceRef: params.sourceRef,
      sourceType: params.sourceType,
      templateId: params.templateId,
      sourceProfile: sourceProfile.sourceProfile,
      renderTemplate,
    },
    suitableFor: buildSuitableFor(focusKeywords),
    outcomes: [
      "拿到一份可检索、可复盘的章节化内容。",
      "快速定位关键观点与对应时间戳引用。",
      "直接使用行动清单推进下一步实践。",
    ],
    oneLineConclusion: `本期围绕${(focusKeywords.length ? focusKeywords : chapters.slice(0, 3).map((chapter) => chapter.title))
      .slice(0, 3)
      .join("、")}展开，核心是把讨论转成可追踪的判断与行动。`,
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
  const normalizedBaseModel: BookletModel = {
    ...baseModel,
    tldr: normalizeModelTldr(baseModel.tldr, baseModel.chapters, sourceProfile.sourceProfile, topKeywords),
  };

  const method = params.generationMethod ?? "C";
  if (method === "A") {
    const methodAQualityIssues = countModelQualityIssues(normalizedBaseModel);
    const methodAQualityGate = isQualityGatePassed(methodAQualityIssues);
    pushInspectorStage(params.inspector, {
      stage: "normalization",
      notes: `Transcript source profile: ${sourceProfile.sourceProfile} (confidence ${sourceProfile.confidence})`,
      input: sourceProfile.signals,
      output: {
        selected_profile: sourceProfile.sourceProfile,
        selected_profile_confidence: sourceProfile.confidence,
        chapter_count: normalizedBaseModel.chapters.length,
        tldr_count: normalizedBaseModel.tldr.length,
        terms_count: normalizedBaseModel.terms.length,
      },
      config: {
        source_profile: sourceProfile.sourceProfile,
      },
    });
    pushInspectorStage(params.inspector, {
      stage: "normalization",
      notes: methodAQualityIssues.length
        ? "Method A: parser/rule-first deterministic booklet (LLM disabled), quality probe has warnings."
        : "Method A: parser/rule-first deterministic booklet (LLM disabled), quality probe passed.",
      input: {
        generation_method: method,
        parsed_entries: entries.length,
        planned_chapters: chapterPlan.length,
        quality_issue_count: methodAQualityIssues.length,
        quality_warning_count: methodAQualityGate.warningCount,
        quality_passed: methodAQualityGate.passed,
        source_profile: sourceProfile.sourceProfile,
        source_profile_confidence: sourceProfile.confidence,
      },
      output: {
        final_chapters: normalizedBaseModel.chapters.length,
        tldr_count: normalizedBaseModel.tldr.length,
        terms_count: normalizedBaseModel.terms.length,
        quality_issues: methodAQualityIssues,
        quality_passed: methodAQualityGate.passed,
        quality_blocking_issues: methodAQualityGate.blockingIssues,
        quality_warning_issues: methodAQualityGate.warningIssues,
      },
      config: {
        source_type: params.sourceType,
        source_profile: sourceProfile.sourceProfile,
        source_profile_confidence: sourceProfile.confidence,
        profile_name: PROFILE_RESOLVED_NAME[sourceProfile.sourceProfile],
        quality_gate: {
          enabled: true,
          warning_max: QUALITY_GATE_WARNING_MAX,
          status: methodAQualityGate.passed ? "passed" : "failed",
        },
      },
    });
    return normalizedBaseModel;
  }

  const baselineQualityIssues = countModelQualityIssues(normalizedBaseModel);
  const baselineQualityGate = isQualityGatePassed(baselineQualityIssues);
  pushInspectorStage(params.inspector, {
    stage: "normalization",
    notes: baselineQualityIssues.length ? "Quality probe (base model) has warnings." : "Quality probe (base model) passed.",
    input: {
      source_profile: sourceProfile.sourceProfile,
      source_profile_confidence: sourceProfile.confidence,
      chapter_count: normalizedBaseModel.chapters.length,
      quality_issue_count: baselineQualityIssues.length,
      quality_warning_count: baselineQualityGate.warningCount,
      quality_passed: baselineQualityGate.passed,
    },
    output: {
      quality_issues: baselineQualityIssues,
      quality_passed: baselineQualityGate.passed,
      quality_blocking_issues: baselineQualityGate.blockingIssues,
      quality_warning_issues: baselineQualityGate.warningIssues,
    },
  });

  const forceChapterPath = transcriptBody.length > FULL_BOOK_LLM_MAX_CHARS;
  let llmDraft: Awaited<ReturnType<typeof generateBookletDraftWithLlm>> = null;
  if (forceChapterPath) {
    pushInspectorStage(params.inspector, {
      stage: "llm_response",
      notes: "Full-book LLM skipped for long transcript; chapter-level LLM path selected.",
      input: {
        transcript_chars: transcriptBody.length,
        full_book_max_chars: FULL_BOOK_LLM_MAX_CHARS,
      },
      output: {
        parse_ok: null,
        full_book_skipped: true,
      },
    });
  } else {
    llmDraft = await generateBookletDraftWithLlm({
      title: resolvedTitle,
      language: params.language,
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      chapterRanges: normalizedBaseModel.chapters.map((chapter) => `${chapter.title}（${chapter.range}）`),
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
      promptProfile: method === "C" ? "strict_template_a" : "baseline",
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
  }
  const evidence = buildQuoteEvidenceIndex(entries);
  const chapterEvidenceMap = buildChapterEvidenceMap(entries, chapterPlan);
  const chapterPatches = new Map<number, LlmChapterPatch>();
  if (!llmDraft) {
    for (const plan of chapterPlan) {
      const chunk = entries.slice(plan.startIndex, plan.endIndex + 1);
      const patch = await generateChapterPatchWithLlm({
        title: plan.title,
        range: plan.range,
        language: params.language,
        sourceType: params.sourceType,
        sourceRef: params.sourceRef,
        transcriptExcerpt: buildChapterPatchTranscriptExcerpt(chunk),
        promptProfile: method === "C" ? "strict_template_a" : "baseline",
      });
      if (patch) {
        chapterPatches.set(plan.chapterIndex, patch);
      }
    }
    pushInspectorStage(params.inspector, {
      stage: "llm_response",
      notes: forceChapterPath
        ? chapterPatches.size
          ? "Chapter-level LLM primary path applied for long transcript."
          : "Chapter-level LLM primary path produced no usable patch."
        : chapterPatches.size
          ? "Full-book LLM draft unavailable; chapter-level patch retry applied once."
          : "Full-book LLM draft unavailable; chapter-level patch retry returned no usable patch.",
      input: {
        retry_strategy: forceChapterPath ? "chapter_patch_primary" : "chapter_patch_once",
        requested_chapters: chapterPlan.length,
      },
      output: {
        patched_chapters: chapterPatches.size,
        patched_indices: Array.from(chapterPatches.keys()),
      },
    });
  }

  let finalModel = mergeBookletWithLlmDraft(normalizedBaseModel, llmDraft, evidence, chapterEvidenceMap, mergeCaps);
  if (!llmDraft && chapterPatches.size) {
    finalModel = mergeBookletWithChapterPatches(finalModel, chapterPatches, mergeCaps);
  }
  finalModel = {
    ...finalModel,
    tldr: normalizeModelTldr(finalModel.tldr, finalModel.chapters, sourceProfile.sourceProfile, topKeywords),
  };
  const finalQualityIssues = countModelQualityIssues(finalModel);
  const finalQualityGate = isQualityGatePassed(finalQualityIssues);
  const renderLayoutPreview = buildRenderChapterViews(finalModel);
  const discussionBodyStartCoverage = renderLayoutPreview.isDiscussion
    ? estimateDiscussionBodyStartCoverage(finalModel.chapters, renderLayoutPreview.frontMatterChapters.length)
    : null;
  pushInspectorStage(params.inspector, {
    stage: "normalization",
    input: {
      generation_method: method,
      parsed_entries: entries.length,
      planned_chapters: chapterPlan.length,
      llm_draft_available: Boolean(llmDraft),
      chapter_patch_retry_applied: !llmDraft,
      chapter_patch_count: chapterPatches.size,
      base_title: baseModel.meta.title,
    },
    output: {
      final_chapters: finalModel.chapters.length,
      chapter_titles: finalModel.chapters.map((chapter) => chapter.title),
      tldr_count: finalModel.tldr.length,
      terms_count: finalModel.terms.length,
      render_front_count: renderLayoutPreview.frontMatterChapters.length,
      render_body_count: renderLayoutPreview.bodyChapters.length,
      render_first_body_range: renderLayoutPreview.bodyChapters[0]?.chapter.range ?? null,
      render_body_start_coverage_ratio:
        discussionBodyStartCoverage == null ? null : Number(discussionBodyStartCoverage.toFixed(3)),
      quality_issue_count: finalQualityIssues.length,
      quality_warning_count: finalQualityGate.warningCount,
      quality_blocking_count: finalQualityGate.blockingIssues.length,
      quality_passed: finalQualityGate.passed,
      quality_issues: finalQualityIssues,
      quality_blocking_issues: finalQualityGate.blockingIssues,
      quality_warning_issues: finalQualityGate.warningIssues,
    },
    config: {
      merge_caps: mergeCaps,
      source_type: params.sourceType,
      prompt_profile: method === "C" ? "strict_template_a" : "baseline",
      profile_used: sourceProfile.sourceProfile,
      profile_confidence: sourceProfile.confidence,
      quality_gate: {
        enabled: true,
        warning_max: QUALITY_GATE_WARNING_MAX,
        status: finalQualityGate.passed ? "passed" : "failed",
      },
      render_layout_guard: {
        discussion_max_front_matter_chapters: DISCUSSION_MAX_FRONT_MATTER_CHAPTERS,
        discussion_min_body_chapters: DISCUSSION_MIN_BODY_CHAPTERS,
        discussion_max_body_start_coverage: DISCUSSION_MAX_BODY_START_COVERAGE,
      },
    },
    notes: finalQualityGate.passed ? "Quality gate passed." : "Quality gate failed.",
  });
  return finalModel;
}

type RenderChapterView = {
  chapter: BookletChapter;
  displayIndex: number;
  displaySectionId: string;
};

const DISCUSSION_MAX_FRONT_MATTER_CHAPTERS = 2;
const DISCUSSION_MIN_BODY_CHAPTERS = 3;
const DISCUSSION_MAX_BODY_START_COVERAGE = 0.35;

function chapterRangeStartSeconds(range: string): number | null {
  const start = cleanLine(String(range || "").split("-")[0] ?? "");
  return parseTimestampToSeconds(start);
}

function chapterRangeEndSeconds(range: string): number | null {
  const parts = String(range || "").split("-");
  const end = cleanLine(parts[1] ?? parts[0] ?? "");
  return parseTimestampToSeconds(end);
}

function estimateDiscussionBodyStartCoverage(chapters: BookletChapter[], frontCount: number): number | null {
  if (!chapters.length || frontCount < 0 || frontCount >= chapters.length) {
    return null;
  }
  const allStart = chapterRangeStartSeconds(chapters[0]?.range ?? "");
  const allEnd = chapterRangeEndSeconds(chapters[chapters.length - 1]?.range ?? "");
  const bodyStart = chapterRangeStartSeconds(chapters[frontCount]?.range ?? "");
  if (allStart == null || allEnd == null || bodyStart == null) {
    return null;
  }
  const total = allEnd - allStart;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const covered = bodyStart - allStart;
  if (!Number.isFinite(covered) || covered < 0) {
    return null;
  }
  return Math.min(1, covered / total);
}

function isLikelyDiscussionFrontMatterChapter(chapter: BookletChapter): boolean {
  const textBlob = cleanLine(
    [chapter.title, ...chapter.points.slice(0, 2), chapter.explanation.background, chapter.explanation.coreConcept].join(" "),
  );
  if (/(开场|导语|背景设定|问题设定|讨论框架|争议轴|本期要聊|先说|先聊|近况|update|自我介绍|寒暄|铺垫)/i.test(textBlob)) {
    return true;
  }
  return false;
}

function buildRenderChapterViews(model: BookletModel): {
  isDiscussion: boolean;
  frontMatterChapters: BookletChapter[];
  bodyChapters: RenderChapterView[];
} {
  const isDiscussion = model.meta.renderTemplate === "discussion-roundtable-v1";
  if (!isDiscussion) {
    return {
      isDiscussion: false,
      frontMatterChapters: [],
      bodyChapters: model.chapters.map((chapter) => ({
        chapter,
        displayIndex: chapter.index,
        displaySectionId: chapter.sectionId,
      })),
    };
  }
  let frontCount = 0;
  for (let index = 0; index < model.chapters.length - 1; index += 1) {
    const chapter = model.chapters[index];
    const remaining = model.chapters.length - (index + 1);
    if (remaining < 2) {
      break;
    }
    if (!isLikelyDiscussionFrontMatterChapter(chapter)) {
      break;
    }
    frontCount += 1;
  }
  const minBodyChapters = Math.min(model.chapters.length, DISCUSSION_MIN_BODY_CHAPTERS);
  const maxFrontByBody = Math.max(0, model.chapters.length - minBodyChapters);
  frontCount = Math.min(frontCount, DISCUSSION_MAX_FRONT_MATTER_CHAPTERS, maxFrontByBody);

  while (frontCount > 0) {
    const coverage = estimateDiscussionBodyStartCoverage(model.chapters, frontCount);
    if (coverage != null && coverage > DISCUSSION_MAX_BODY_START_COVERAGE) {
      frontCount -= 1;
      continue;
    }
    break;
  }

  const frontMatterChapters = model.chapters.slice(0, frontCount);
  const bodyChapters = model.chapters.slice(frontCount).map((chapter, index) => ({
    chapter,
    displayIndex: index + 1,
    displaySectionId: `chap_${String(index + 4).padStart(2, "0")}`,
  }));
  return { isDiscussion: true, frontMatterChapters, bodyChapters };
}

type RenderChapterLayout = ReturnType<typeof buildRenderChapterViews>;

function buildDiscussionMapItems(layout: RenderChapterLayout): RenderChapterView[] {
  if (layout.bodyChapters.length) {
    return layout.bodyChapters;
  }
  return layout.frontMatterChapters.map((chapter, index) => ({
    chapter,
    displayIndex: index + 1,
    displaySectionId: chapter.sectionId,
  }));
}

function buildDiscussionMapLines(items: RenderChapterView[]): string[] {
  return uniqueNonEmpty(items.map((item) => `${item.chapter.title}（${item.chapter.range}）`).filter(Boolean));
}

function buildJudgmentFrameworkItems(chapter: BookletChapter): string[] {
  const derived = chapter.actions
    .map((action) => cleanLine(action.replace(/^行动\s*\d+\s*[：:]/, "")))
    .filter(Boolean)
    .map((item) => `判断是否成立：${item}`);
  const explanationBased = [
    chapter.explanation.judgmentFramework && `判断边界：${chapter.explanation.judgmentFramework}`,
    chapter.explanation.commonMisunderstanding && `避免误读：${chapter.explanation.commonMisunderstanding}`,
  ].filter((item): item is string => Boolean(item));
  return uniqueNonEmpty([...derived, ...explanationBased]).slice(0, 4);
}

function buildDiscussionConsensusAndOpenItems(chapter: BookletChapter): string[] {
  return uniqueNonEmpty([
    `当前最小共识：${chapter.points[0] ?? chapter.explanation.background}`,
    `主要分歧：${chapter.explanation.coreConcept}`,
    `判断边界：${chapter.explanation.judgmentFramework}`,
    `仍待验证：${chapter.explanation.commonMisunderstanding}`,
  ]);
}

function buildDiscussionFollowupActions(chapter: BookletChapter): string[] {
  const directActions = uniqueNonEmpty(chapter.actions.map((action) => cleanLine(action)).filter(Boolean));
  if (directActions.length) {
    return directActions;
  }
  const fallback = buildJudgmentFrameworkItems(chapter).map((item) => cleanLine(item.replace(/^判断是否成立：/, "验证动作：")));
  return fallback.length ? fallback : ["从本章争议里选 1 个命题，补齐证据后再做判断。"];
}

function buildDiscussionOpenQuestionLines(bodyChapters: RenderChapterView[], model: BookletModel): string[] {
  const bodyDriven = uniqueNonEmpty(
    bodyChapters.flatMap((item) => item.chapter.actions.map((action) => cleanLine(action))).filter(Boolean),
  );
  if (bodyDriven.length) {
    return bodyDriven;
  }
  return uniqueNonEmpty([...model.actionNow, ...model.actionWeek, ...model.actionLong].map((line) => cleanLine(line)).filter(Boolean));
}

function buildMarkdownContent(model: BookletModel): string {
  const layout = buildRenderChapterViews(model);
  const lines: string[] = [
    `# ${model.meta.title}`,
    "",
    `- Language: ${model.meta.language}`,
    `- Creator: ${model.meta.creator}`,
    `- Generated At: ${model.meta.generatedAtIso}`,
    `- Source Ref: ${model.meta.sourceRef}`,
    `- Render Template: ${model.meta.renderTemplate}`,
    "",
  ];

  if (layout.isDiscussion) {
    const discussionMapItems = buildDiscussionMapItems(layout);
    const discussionMapLines = buildDiscussionMapLines(discussionMapItems);
    const discussionSummaryLines = buildDiscussionSummaryFromBodyChapters(layout.bodyChapters);
    const discussionOpenQuestions = buildDiscussionOpenQuestionLines(layout.bodyChapters, model);

    lines.push("## 讨论地图");
    lines.push("");
    if (discussionMapLines.length) {
      lines.push(...discussionMapLines.map((line) => `- ${line}`));
    } else {
      lines.push(`> ${model.oneLineConclusion}`);
    }
    lines.push("");
    lines.push("## 结论速览");
    lines.push(...discussionSummaryLines.map((item, index) => `${index + 1}. ${item}`));
    lines.push("");
    lines.push("## 正文目录");
    lines.push(...layout.bodyChapters.map((item) => `- 第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`));
    lines.push("");

    for (const item of layout.bodyChapters) {
      const chapter = item.chapter;
      lines.push(`## 第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`);
      lines.push("");
      lines.push("### 争议命题");
      lines.push(`- ${chapter.title}（${chapter.range}）`);
      lines.push("");
      lines.push("### 观点分歧（谁在主张什么）");
      lines.push(...chapter.points.map((point) => `- ${point}`));
      lines.push("");
      lines.push("### 证据锚点（原句 + 时间戳）");
      lines.push(...chapter.quotes.map((quote) => `- [${quote.timestamp}] **${quote.speaker}**：${quote.text}`));
      lines.push("");
      lines.push("### 共识与未决");
      lines.push(...buildDiscussionConsensusAndOpenItems(chapter).map((itemLine) => `- ${itemLine}`));
      lines.push("");
      lines.push("### 讨论后可验证动作");
      lines.push(...buildDiscussionFollowupActions(chapter).map((itemLine) => `- ${itemLine}`));
      lines.push("");
    }

    lines.push("## 共识清单与未决问题");
    lines.push("");
    lines.push("### 当前共识");
    lines.push(...discussionSummaryLines.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 仍待讨论");
    lines.push(...discussionOpenQuestions.map((item) => `- ${item}`));
    lines.push("");
  } else {
    lines.push("## 读前速览");
    lines.push("");
    lines.push("### 这期适合谁");
    lines.push(...model.suitableFor.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 一句话结论");
    lines.push(`> ${model.oneLineConclusion}`);
    lines.push("");
    lines.push("## 关键要点摘要（TL;DR）");
    lines.push(...model.tldr.map((item, index) => `${index + 1}. ${item}`));
    lines.push("");
    lines.push("## 目录（建议 5–7 章）");
    lines.push(...layout.bodyChapters.map((item) => `- 第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`));
    lines.push("");

    for (const item of layout.bodyChapters) {
      const chapter = item.chapter;
      lines.push(`## 第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`);
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

    lines.push("## 行动清单（汇总版）");
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
  }

  lines.push("## 概念与术语表（v1）");
  lines.push(...model.terms.map((term) => `- **${term.term}**：${term.definition}`));
  lines.push("");
  lines.push("## 附录：精选原句（按主题）");
  for (const theme of model.appendixThemes) {
    lines.push("");
    lines.push(`### ${theme.name}`);
    lines.push(...theme.quotes.map((quote) => `- [${quote.timestamp}] **${quote.speaker}**：${quote.text}`));
  }
  lines.push("");
  lines.push("## 制作信息");
  lines.push(`- 输入：${model.meta.sourceType}`);
  lines.push(`- 结构模板：${model.meta.templateId}`);
  lines.push(`- 渲染模板：${model.meta.renderTemplate}`);
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
    const layout = buildRenderChapterViews(model);

    if (layout.isDiscussion) {
      const discussionMapItems = buildDiscussionMapItems(layout);
      const discussionMapLines = buildDiscussionMapLines(discussionMapItems);
      const discussionSummaryLines = buildDiscussionSummaryFromBodyChapters(layout.bodyChapters);
      const discussionOpenQuestions = buildDiscussionOpenQuestionLines(layout.bodyChapters, model);

      beginSection("讨论地图");
      doc.fontSize(20).text(model.meta.title);
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Language: ${model.meta.language}`);
      doc.fontSize(10).text(`Generated: ${model.meta.generatedAtIso}`);
      doc.fontSize(10).text(`Source: ${model.meta.sourceRef}`);
      doc.fontSize(10).text(`Template: ${model.meta.renderTemplate}`);
      doc.moveDown(0.6);
      if (discussionMapLines.length) {
        writePdfBulletList(doc, discussionMapLines);
      } else {
        doc.fontSize(11).text(model.oneLineConclusion);
      }

      beginSection("结论速览");
      writePdfBulletList(
        doc,
        discussionSummaryLines.map((item, index) => `${index + 1}. ${item}`),
      );

      beginSection("正文目录");
      writePdfBulletList(
        doc,
        layout.bodyChapters.map((item) => `第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`),
      );

      for (const item of layout.bodyChapters) {
        const chapter = item.chapter;
        beginSection(`第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`);
        doc.fontSize(13).text("争议命题");
        writePdfBulletList(doc, [`${chapter.title}（${chapter.range}）`]);
        doc.fontSize(13).text("观点分歧（谁在主张什么）");
        writePdfBulletList(doc, chapter.points);
        doc.fontSize(13).text("证据锚点（原句 + 时间戳）");
        writePdfQuoteList(doc, chapter.quotes);
        doc.fontSize(13).text("共识与未决");
        writePdfBulletList(doc, buildDiscussionConsensusAndOpenItems(chapter));
        doc.fontSize(13).text("讨论后可验证动作");
        writePdfBulletList(doc, buildDiscussionFollowupActions(chapter));
      }

      beginSection("共识清单与未决问题");
      doc.fontSize(13).text("当前共识");
      writePdfBulletList(doc, discussionSummaryLines);
      doc.fontSize(13).text("仍待讨论");
      writePdfBulletList(doc, discussionOpenQuestions);
    } else {
      beginSection("读前速览");
      doc.fontSize(20).text(model.meta.title);
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Language: ${model.meta.language}`);
      doc.fontSize(10).text(`Generated: ${model.meta.generatedAtIso}`);
      doc.fontSize(10).text(`Source: ${model.meta.sourceRef}`);
      doc.fontSize(10).text(`Template: ${model.meta.renderTemplate}`);
      doc.moveDown(0.6);
      doc.fontSize(13).text("这期适合谁");
      writePdfBulletList(doc, model.suitableFor);
      doc.fontSize(13).text("一句话结论");
      doc.fontSize(11).text(model.oneLineConclusion);

      beginSection("关键要点摘要（TL;DR）");
      writePdfBulletList(
        doc,
        model.tldr.map((item, index) => `${index + 1}. ${item}`),
      );

      beginSection("目录（建议 5–7 章）");
      writePdfBulletList(
        doc,
        layout.bodyChapters.map((item) => `第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`),
      );

      for (const item of layout.bodyChapters) {
        const chapter = item.chapter;
        beginSection(`第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`);
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

      beginSection("行动清单（汇总版）");
      doc.fontSize(13).text("今天就做（≤ 15 分钟）");
      writePdfBulletList(doc, model.actionNow);
      doc.fontSize(13).text("这周内做（需要安排时间）");
      writePdfBulletList(doc, model.actionWeek);
      doc.fontSize(13).text("长期习惯（可量化）");
      writePdfBulletList(doc, model.actionLong);
    }

    beginSection("概念与术语表（v1）");
    writePdfBulletList(doc, model.terms.map((term) => `${term.term}：${term.definition}`));

    beginSection("附录：精选原句（按主题）");
    for (const theme of model.appendixThemes) {
      doc.fontSize(13).text(theme.name);
      writePdfQuoteList(doc, theme.quotes);
    }

    beginSection("制作信息");
    writePdfBulletList(doc, [
      `输入：${model.meta.sourceType}`,
      `结构模板：${model.meta.templateId}`,
      `渲染模板：${model.meta.renderTemplate}`,
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
  const layout = buildRenderChapterViews(model);

  if (layout.isDiscussion) {
    const discussionMapItems = buildDiscussionMapItems(layout);
    const discussionMapLines = buildDiscussionMapLines(discussionMapItems);
    const discussionSummaryLines = buildDiscussionSummaryFromBodyChapters(layout.bodyChapters);
    const discussionOpenQuestions = buildDiscussionOpenQuestionLines(layout.bodyChapters, model);

    files.push({
      id: "chap_01",
      fileName: "chap_01.xhtml",
      title: "讨论地图",
      bodyHtml: discussionMapLines.length
        ? listToHtml(discussionMapLines)
        : `<blockquote>${escapeHtml(model.oneLineConclusion)}</blockquote>`,
    });
    files.push({
      id: "chap_02",
      fileName: "chap_02.xhtml",
      title: "结论速览",
      bodyHtml: `<ol>${discussionSummaryLines.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`,
    });
    files.push({
      id: "chap_03",
      fileName: "chap_03.xhtml",
      title: "正文目录",
      bodyHtml: listToHtml(
        layout.bodyChapters.map((item) => `第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`),
      ),
    });

    for (const item of layout.bodyChapters) {
      const chapter = item.chapter;
      files.push({
        id: item.displaySectionId,
        fileName: `${item.displaySectionId}.xhtml`,
        title: `第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`,
        bodyHtml: [
          "<h3>争议命题</h3>",
          listToHtml([`${chapter.title}（${chapter.range}）`]),
          "<h3>观点分歧（谁在主张什么）</h3>",
          listToHtml(chapter.points),
          "<h3>证据锚点（原句 + 时间戳）</h3>",
          quoteListToHtml(chapter.quotes),
          "<h3>共识与未决</h3>",
          listToHtml(buildDiscussionConsensusAndOpenItems(chapter)),
          "<h3>讨论后可验证动作</h3>",
          listToHtml(buildDiscussionFollowupActions(chapter)),
        ].join(""),
      });
    }

    files.push({
      id: "chap_11",
      fileName: "chap_11.xhtml",
      title: "共识清单与未决问题",
      bodyHtml: [
        "<h3>当前共识</h3>",
        listToHtml(discussionSummaryLines),
        "<h3>仍待讨论</h3>",
        listToHtml(discussionOpenQuestions),
      ].join(""),
    });
  } else {
    files.push({
      id: "chap_01",
      fileName: "chap_01.xhtml",
      title: "读前速览",
      bodyHtml: [
        "<h3>这期适合谁</h3>",
        listToHtml(model.suitableFor),
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
      bodyHtml: listToHtml(
        layout.bodyChapters.map((item) => `第 ${item.displayIndex} 章：${item.chapter.title}（${item.chapter.range}）`),
      ),
    });

    for (const item of layout.bodyChapters) {
      const chapter = item.chapter;
      files.push({
        id: item.displaySectionId,
        fileName: `${item.displaySectionId}.xhtml`,
        title: `第 ${item.displayIndex} 章：${chapter.title}（${chapter.range}）`,
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
  }

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
      `渲染模板：${model.meta.renderTemplate}`,
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
      <h2>${escapeHtml(chapter.title)}</h2>
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
  generationMethod?: GenerationMethod;
  inspector?: (stage: InspectorPushInput) => void;
}) {
  await createArtifactsWithMode({
    ...params,
    persistToDatabase: true,
  });
}

export async function createArtifactsEphemeral(params: {
  jobId: string;
  formats: OutputFormat[];
  title: string;
  language: string;
  transcriptText: string;
  templateId: string;
  sourceType: SourceType;
  sourceRef?: string;
  generationMethod?: GenerationMethod;
  inspector?: (stage: InspectorPushInput) => void;
}): Promise<ArtifactRecord[]> {
  return createArtifactsWithMode({
    ...params,
    persistToDatabase: false,
  });
}

async function createArtifactsWithMode(params: {
  jobId: string;
  formats: OutputFormat[];
  title: string;
  language: string;
  transcriptText: string;
  templateId: string;
  sourceType: SourceType;
  sourceRef?: string;
  generationMethod?: GenerationMethod;
  inspector?: (stage: InspectorPushInput) => void;
  persistToDatabase: boolean;
}): Promise<ArtifactRecord[]> {
  const booklet = await buildBookletModel({
    jobId: params.jobId,
    title: params.title,
    language: params.language,
    transcriptText: params.transcriptText,
    templateId: params.templateId,
    sourceType: params.sourceType,
    sourceRef: params.sourceRef?.trim() || "N/A",
    generationMethod: params.generationMethod,
    inspector: params.inspector,
  });

  const artifacts: ArtifactRecord[] = [];
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
    if (params.persistToDatabase) {
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
    artifacts.push({
      type: format,
      fileName: built.fileName,
      sizeBytes: built.sizeBytes,
      downloadUrl: `${config.publicBaseUrl}/downloads/${params.jobId}/${encodeURIComponent(built.fileName)}?token=dev`,
      expiresAt,
    });
  }
  return artifacts;
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

const TRANSCRIPT_SAMPLE_PREVIEW_MAX = 240;

function transcriptSamplePreview(input: string): string {
  const cleaned = cleanLine(input.replace(/\s+/g, " "));
  if (cleaned.length <= TRANSCRIPT_SAMPLE_PREVIEW_MAX) {
    return cleaned;
  }
  return `${cleaned.slice(0, TRANSCRIPT_SAMPLE_PREVIEW_MAX - 1)}…`;
}

export async function listRecentTranscriptSamples(
  userId: string,
  limit: number,
): Promise<TranscriptSampleSummary[]> {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const result = await db.query<{
    job_id: string;
    title: string | null;
    language: string | null;
    created_at: string;
    transcript_text: string | null;
  }>(
    `SELECT j.id AS job_id,
            j.title,
            j.language,
            j.created_at,
            ji.metadata->>'transcript_text' AS transcript_text
       FROM jobs j
       JOIN job_inputs ji ON ji.job_id = j.id
      WHERE j.user_id = $1
        AND j.source_type = 'transcript'::source_type
        AND COALESCE(ji.metadata->>'transcript_text', '') <> ''
      ORDER BY j.created_at DESC
      LIMIT $2`,
    [userId, safeLimit],
  );

  return result.rows.map((row) => {
    const transcriptText = String(row.transcript_text ?? "");
    return {
      jobId: row.job_id,
      title: cleanLine(row.title ?? "Untitled Transcript"),
      language: cleanLine(row.language ?? "zh-CN"),
      createdAt: row.created_at,
      charCount: transcriptText.length,
      preview: transcriptSamplePreview(transcriptText),
    };
  });
}

export async function getTranscriptSampleByJobId(
  jobId: string,
  userId: string,
): Promise<TranscriptSampleDetail | null> {
  const result = await db.query<{
    job_id: string;
    title: string | null;
    language: string | null;
    created_at: string;
    transcript_text: string | null;
  }>(
    `SELECT j.id AS job_id,
            j.title,
            j.language,
            j.created_at,
            ji.metadata->>'transcript_text' AS transcript_text
       FROM jobs j
       JOIN job_inputs ji ON ji.job_id = j.id
      WHERE j.id = $1
        AND j.user_id = $2
        AND j.source_type = 'transcript'::source_type
      LIMIT 1`,
    [jobId, userId],
  );
  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  const row = result.rows[0];
  const transcriptText = String(row.transcript_text ?? "");
  if (!transcriptText.trim()) {
    return null;
  }
  return {
    jobId: row.job_id,
    title: cleanLine(row.title ?? "Untitled Transcript"),
    language: cleanLine(row.language ?? "zh-CN"),
    createdAt: row.created_at,
    charCount: transcriptText.length,
    preview: transcriptSamplePreview(transcriptText),
    transcriptText,
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

export async function appendJobInspectorStage(jobId: string, stage: InspectorStageRecord): Promise<void> {
  await db.query(
    `UPDATE job_inputs
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'inspector_trace',
          COALESCE(metadata->'inspector_trace', '[]'::jsonb) || $2::jsonb
        )
      WHERE job_id = $1`,
    [jobId, JSON.stringify([stage])],
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
