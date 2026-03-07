import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT_DIR, "..");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TOKEN = process.env.AUTH_TOKEN ?? "dev:cecilia@example.com";
const FIXTURE_PATH = path.resolve(REPO_ROOT, "tasks/method-compare/2026-03-02T08-09-12-196Z/method-C.json");
const TARGET_RUN_EPUB = path.resolve(
  REPO_ROOT,
  "backend/.dev-artifacts/run_8acec80486ee62a7/run_8acec80486ee62a7.epub",
);
const REPORT_PATH = path.resolve(REPO_ROOT, "backend/.dev-artifacts/_debug/run8ace_repro_report.json");

type InlineCreateResponse = {
  job_id: string;
  status: string;
  artifacts: Array<{
    type: string;
    file_name: string;
    size_bytes: number;
    download_url: string;
    expires_at: string;
  }>;
  stages: Array<{
    stage: string;
    ts: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    config?: Record<string, unknown>;
    notes?: string;
  }>;
};

type ParsedEpub = {
  bookTitle: string;
  navChapterTitles: string[];
  combinedChapterHash: string;
  stableBodyHash: string;
  chapterHashes: Record<string, string>;
};

type ReproRun = {
  runId: string;
  parsed: ParsedEpub;
  fullBookMaxChars: number | null;
  fullBookSkipped: boolean;
  llmNotes: string[];
};

async function readFixtureTranscript(): Promise<{ transcriptText: string; title: string; language: string }> {
  const raw = await fs.readFile(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as {
    createRequest?: { transcript_text?: string; title?: string; language?: string };
  };
  const transcriptText = parsed.createRequest?.transcript_text ?? "";
  assert.ok(transcriptText.length > 1000, "Fixture transcript_text missing or too short.");
  return {
    transcriptText,
    title: parsed.createRequest?.title ?? "077 · Vibe Shift 三部曲：匮乏时代的流行文化",
    language: parsed.createRequest?.language ?? "zh-CN",
  };
}

async function httpJson<T>(pathName: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL.replace(/\/$/, "")}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${method} ${pathName}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function downloadToTemp(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "run8ace-repro-"));
  const epubPath = path.join(tmpDir, "artifact.epub");
  await fs.writeFile(epubPath, bytes);
  return epubPath;
}

async function parseEpub(epubPath: string): Promise<ParsedEpub> {
  const unzipDir = await fs.mkdtemp(path.join(os.tmpdir(), "run8ace-unzip-"));
  await execFileAsync("unzip", ["-q", epubPath, "-d", unzipDir]);

  const navPath = path.join(unzipDir, "OEBPS", "nav.xhtml");
  const navText = await fs.readFile(navPath, "utf8");
  const bookTitleMatch = navText.match(/<h1>([\s\S]*?)<\/h1>/i);
  const bookTitle = (bookTitleMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim();

  const navChapterTitles = Array.from(navText.matchAll(/<a href="chap_\d+\.xhtml">([\s\S]*?)<\/a>/g)).map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );

  const chapterDir = path.join(unzipDir, "OEBPS");
  const chapterFiles = (await fs.readdir(chapterDir))
    .filter((name) => /^chap_\d+\.xhtml$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  const chapterHashes: Record<string, string> = {};
  const combinedHasher = createHash("sha256");
  const stableHasher = createHash("sha256");
  for (const file of chapterFiles) {
    const filePath = path.join(chapterDir, file);
    const text = await fs.readFile(filePath, "utf8");
    const normalized = text.replace(/<meta[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const hash = createHash("sha256").update(normalized).digest("hex");
    chapterHashes[file] = hash;
    combinedHasher.update(normalized);
    if (file !== "chap_14.xhtml") {
      stableHasher.update(normalized);
    }
  }

  return {
    bookTitle,
    navChapterTitles,
    combinedChapterHash: combinedHasher.digest("hex"),
    stableBodyHash: stableHasher.digest("hex"),
    chapterHashes,
  };
}

function extractLlmDebug(stages: InlineCreateResponse["stages"]): {
  fullBookMaxChars: number | null;
  fullBookSkipped: boolean;
  llmNotes: string[];
} {
  let fullBookMaxChars: number | null = null;
  let fullBookSkipped = false;
  const llmNotes: string[] = [];

  for (const stage of stages) {
    if (stage.stage !== "llm_response") {
      continue;
    }
    if (typeof stage.notes === "string" && stage.notes.trim()) {
      llmNotes.push(stage.notes.trim());
    }
    const input = stage.input ?? {};
    const output = stage.output ?? {};
    const maybeMax = input.full_book_max_chars;
    if (typeof maybeMax === "number") {
      fullBookMaxChars = maybeMax;
    }
    if (output.full_book_skipped === true) {
      fullBookSkipped = true;
    }
  }

  return { fullBookMaxChars, fullBookSkipped, llmNotes };
}

async function runInlineOnce(payload: {
  title: string;
  language: string;
  transcriptText: string;
}): Promise<ReproRun> {
  const createResponse = await httpJson<InlineCreateResponse>("/v1/epub/from-transcript", "POST", {
    title: payload.title,
    language: payload.language,
    transcript_text: payload.transcriptText,
    template_id: "templateA-v0-book",
    metadata: {
      episode_url: "https://example.com/repro/run8ace",
      generation_method: "C",
    },
  });

  const epub = createResponse.artifacts.find((item) => item.type === "epub");
  assert.ok(epub?.download_url, "Inline response missing EPUB artifact download URL.");

  const tempEpubPath = await downloadToTemp(epub.download_url);
  const parsed = await parseEpub(tempEpubPath);
  const llmDebug = extractLlmDebug(createResponse.stages);

  return {
    runId: createResponse.job_id,
    parsed,
    ...llmDebug,
  };
}

function findConsecutiveDuplicateChapterTitle(chapterTitles: string[]): string | null {
  const normalize = (title: string): string =>
    title
      .replace(/^第\s*\d+\s*章[:：]\s*/u, "")
      .replace(/\s*[（(][^（）()]*[）)]\s*$/u, "")
      .trim();

  let previous = "";
  for (const title of chapterTitles) {
    if (!/^第\s*\d+\s*章[:：]/u.test(title)) {
      continue;
    }
    const normalized = normalize(title);
    if (normalized && normalized === previous) {
      return normalized;
    }
    previous = normalized;
  }
  return null;
}

async function readThresholdConstants(): Promise<{ srcThreshold: number | null; distThreshold: number | null }> {
  const srcPath = path.resolve(REPO_ROOT, "backend/src/repositories/jobsRepo.ts");
  const distPath = path.resolve(REPO_ROOT, "backend/dist/repositories/jobsRepo.js");
  const [srcText, distText] = await Promise.all([fs.readFile(srcPath, "utf8"), fs.readFile(distPath, "utf8")]);

  const srcMatch = srcText.match(/FULL_BOOK_LLM_MAX_CHARS\s*=\s*([0-9_]+)/);
  const distMatch = distText.match(/FULL_BOOK_LLM_MAX_CHARS\s*=\s*([0-9_]+)/);

  const parse = (raw: string | undefined) => (raw ? Number(raw.replaceAll("_", "")) : null);
  return {
    srcThreshold: parse(srcMatch?.[1]),
    distThreshold: parse(distMatch?.[1]),
  };
}

async function parseTargetRunIfPresent(): Promise<ParsedEpub | null> {
  try {
    await fs.access(TARGET_RUN_EPUB);
  } catch {
    return null;
  }
  return parseEpub(TARGET_RUN_EPUB);
}

async function ensureHealthz(): Promise<void> {
  const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/healthz`);
  assert.equal(response.ok, true, "Backend /healthz is not reachable.");
}

async function main() {
  await ensureHealthz();

  const [{ transcriptText, title, language }, thresholdInfo, targetRun] = await Promise.all([
    readFixtureTranscript(),
    readThresholdConstants(),
    parseTargetRunIfPresent(),
  ]);

  const first = await runInlineOnce({ transcriptText, title, language });
  const second = await runInlineOnce({ transcriptText, title, language });

  const duplicateTitle = findConsecutiveDuplicateChapterTitle(first.parsed.navChapterTitles);
  assert.ok(duplicateTitle, "Expected consecutive duplicate chapter title in reproduction run, but none found.");

  assert.equal(
    first.parsed.stableBodyHash,
    second.parsed.stableBodyHash,
    "Two reruns produced different chapter content hashes; expected stable repeated output for this reproduction.",
  );

  assert.equal(
    first.fullBookMaxChars,
    32000,
    `Expected llm stage to expose full_book_max_chars=32000 (old dist), got ${String(first.fullBookMaxChars)}.`,
  );
  assert.equal(first.fullBookSkipped, true, "Expected full-book LLM to be skipped in reproduction run.");

  if (targetRun) {
    assert.equal(
      first.parsed.stableBodyHash,
      targetRun.stableBodyHash,
      "New rerun does not match run_8ace chapter hash; cannot confirm sameness symptom against target run.",
    );
  }

  const report = {
    checked_at: new Date().toISOString(),
    base_url: BASE_URL,
    thresholds: thresholdInfo,
    target_run: targetRun
      ? {
          run_id: "run_8acec80486ee62a7",
          title: targetRun.bookTitle,
          combined_hash: targetRun.combinedChapterHash,
          stable_body_hash: targetRun.stableBodyHash,
          duplicate_title: findConsecutiveDuplicateChapterTitle(targetRun.navChapterTitles),
        }
      : null,
    reruns: [
      {
        run_id: first.runId,
        title: first.parsed.bookTitle,
        combined_hash: first.parsed.combinedChapterHash,
        stable_body_hash: first.parsed.stableBodyHash,
        duplicate_title: duplicateTitle,
        full_book_max_chars: first.fullBookMaxChars,
        full_book_skipped: first.fullBookSkipped,
        llm_notes: first.llmNotes,
      },
      {
        run_id: second.runId,
        title: second.parsed.bookTitle,
        combined_hash: second.parsed.combinedChapterHash,
        stable_body_hash: second.parsed.stableBodyHash,
        duplicate_title: findConsecutiveDuplicateChapterTitle(second.parsed.navChapterTitles),
        full_book_max_chars: second.fullBookMaxChars,
        full_book_skipped: second.fullBookSkipped,
        llm_notes: second.llmNotes,
      },
    ],
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`PASS: run_8ace reproduction verified. report=${REPORT_PATH}`);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
