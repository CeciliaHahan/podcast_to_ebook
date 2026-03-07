#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_TRANSCRIPT = path.resolve(
  process.cwd(),
  "data/transcripts/圆桌派 第7季 - 窦文涛:许子东:马家辉:陈鲁豫.txt",
);

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:8080",
    token: "dev:cecilia@example.com",
    language: "zh-CN",
    transcriptPath: DEFAULT_TRANSCRIPT,
    outDir: path.resolve(process.cwd(), ".dev-artifacts/staged-runs"),
    episodeUrl: "https://example.com/episodes/roundtable7",
    title: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--base-url" && next) {
      out.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--token" && next) {
      out.token = next;
      index += 1;
      continue;
    }
    if (arg === "--language" && next) {
      out.language = next;
      index += 1;
      continue;
    }
    if (arg === "--transcript" && next) {
      out.transcriptPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--out-dir" && next) {
      out.outDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--episode-url" && next) {
      out.episodeUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--title" && next) {
      out.title = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return out;
}

function printUsage() {
  console.log([
    "Usage: node scripts/run-staged-booklet-flow.mjs [options]",
    "",
    "Options:",
    `  --transcript PATH   Transcript file path (default: ${DEFAULT_TRANSCRIPT})`,
    "  --title TEXT        Override title",
    "  --language TEXT     Language code (default: zh-CN)",
    "  --base-url URL      Backend URL (default: http://localhost:8080)",
    "  --token TOKEN       Auth token (default: dev:cecilia@example.com)",
    "  --episode-url URL   Source URL stored in metadata",
    "  --out-dir PATH      Output directory (default: .dev-artifacts/staged-runs)",
    "  --help              Show this help",
  ].join("\n"));
}

function slugTime() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function titleFromPath(filePath) {
  return path.basename(filePath).replace(/\.txt$/i, "");
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function stageSummary(stages) {
  if (!Array.isArray(stages)) {
    return [];
  }
  return stages.map((stage) => ({
    stage: stage.stage,
    ts: stage.ts,
    has_input: Boolean(stage.input),
    has_output: Boolean(stage.output),
    has_config: Boolean(stage.config),
    notes: stage.notes ?? null,
  }));
}

async function apiRequest({ baseUrl, token, pathName, body }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} POST ${pathName}: ${prettyJson(payload)}`);
  }

  return payload;
}

async function ensureHealthz(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`);
  if (!response.ok) {
    throw new Error(`Backend health check failed at ${baseUrl}/healthz`);
  }
}

async function downloadArtifact(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, bytes);
  return bytes.byteLength;
}

function reportMarkdown(params) {
  return [
    `# Staged Booklet Flow Run`,
    "",
    `- Run ID: ${params.runId}`,
    `- Transcript: ${params.transcriptPath}`,
    `- Title: ${params.title}`,
    `- Language: ${params.language}`,
    `- Base URL: ${params.baseUrl}`,
    `- Output Dir: ${params.outputDir}`,
    "",
    `## Stage Results`,
    "",
    `### Working Notes`,
    `- Job ID: ${params.notes.job_id}`,
    `- Summary Count: ${params.notes.working_notes?.summary?.length ?? 0}`,
    `- Section Count: ${params.notes.working_notes?.sections?.length ?? 0}`,
    "",
    `### Booklet Outline`,
    `- Job ID: ${params.outline.job_id}`,
    `- Section Count: ${params.outline.booklet_outline?.sections?.length ?? 0}`,
    "",
    `### Booklet Draft`,
    `- Job ID: ${params.draft.job_id}`,
    `- Section Count: ${params.draft.booklet_draft?.sections?.length ?? 0}`,
    "",
    `### EPUB`,
    `- Job ID: ${params.epub.job_id}`,
    `- Artifact Count: ${params.epub.artifacts?.length ?? 0}`,
    `- Download URL: ${params.epub.artifacts?.[0]?.download_url ?? "N/A"}`,
    `- Local File: ${params.localEpubPath}`,
    "",
    `## Inspector Summaries`,
    "",
    `### Working Notes`,
    "```json",
    prettyJson(stageSummary(params.notes.stages)),
    "```",
    "",
    `### Booklet Outline`,
    "```json",
    prettyJson(stageSummary(params.outline.stages)),
    "```",
    "",
    `### Booklet Draft`,
    "```json",
    prettyJson(stageSummary(params.draft.stages)),
    "```",
    "",
    `### EPUB`,
    "```json",
    prettyJson(stageSummary(params.epub.stages)),
    "```",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  await ensureHealthz(args.baseUrl);

  const transcriptText = await fs.readFile(args.transcriptPath, "utf8");
  const title = args.title || titleFromPath(args.transcriptPath);
  const runId = slugTime();
  const outputDir = path.join(args.outDir, runId);
  await fs.mkdir(outputDir, { recursive: true });

  const transcriptMeta = {
    title,
    language: args.language,
    metadata: {
      episode_url: args.episodeUrl,
    },
  };

  const notes = await apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    pathName: "/v1/working-notes/from-transcript",
    body: {
      ...transcriptMeta,
      transcript_text: transcriptText,
    },
  });
  await fs.writeFile(path.join(outputDir, "01-working-notes.json"), prettyJson(notes));

  const outline = await apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    pathName: "/v1/booklet-outline/from-working-notes",
    body: {
      ...transcriptMeta,
      working_notes: notes.working_notes,
    },
  });
  await fs.writeFile(path.join(outputDir, "02-booklet-outline.json"), prettyJson(outline));

  const draft = await apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    pathName: "/v1/booklet-draft/from-booklet-outline",
    body: {
      ...transcriptMeta,
      working_notes: notes.working_notes,
      booklet_outline: outline.booklet_outline,
    },
  });
  await fs.writeFile(path.join(outputDir, "03-booklet-draft.json"), prettyJson(draft));

  const epub = await apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    pathName: "/v1/epub/from-booklet-draft",
    body: {
      ...transcriptMeta,
      booklet_draft: draft.booklet_draft,
    },
  });
  await fs.writeFile(path.join(outputDir, "04-epub-response.json"), prettyJson(epub));

  const epubUrl = epub?.artifacts?.[0]?.download_url;
  if (!epubUrl) {
    throw new Error("EPUB response did not include a download URL.");
  }

  const localEpubPath = path.join(outputDir, `${title}.epub`);
  await downloadArtifact(epubUrl, localEpubPath);

  const report = reportMarkdown({
    runId,
    transcriptPath: args.transcriptPath,
    title,
    language: args.language,
    baseUrl: args.baseUrl,
    outputDir,
    notes,
    outline,
    draft,
    epub,
    localEpubPath,
  });
  await fs.writeFile(path.join(outputDir, "README.md"), report);

  console.log([
    "PASS: staged booklet flow completed",
    `run_id=${runId}`,
    `output_dir=${outputDir}`,
    `epub=${localEpubPath}`,
  ].join("\n"));
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});
