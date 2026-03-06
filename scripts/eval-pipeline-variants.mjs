#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:8080",
    token: "dev:cecilia@example.com",
    outDir: path.resolve(process.cwd(), "tasks/pipeline-evals"),
    variants: [],
    transcripts: [],
    transcriptManifest: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) out.baseUrl = next;
    if (arg === "--token" && next) out.token = next;
    if (arg === "--out-dir" && next) out.outDir = path.resolve(next);
    if (arg === "--transcript" && next) out.transcripts.push(path.resolve(next));
    if (arg === "--transcript-manifest" && next) out.transcriptManifest = path.resolve(next);
    if (arg === "--variant" && next) out.variants.push(next);
  }

  if (out.variants.length === 0) {
    out.variants.push("current|/v1/epub/from-transcript|current");
  }

  return out;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sample";
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

async function apiRequest({ baseUrl, token, pathName, method = "GET", body }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${method} ${pathName}: ${prettyJson(payload)}`);
  }

  return payload;
}

function parseVariant(spec) {
  const [nameRaw, pathNameRaw, pipelineVariantRaw] = String(spec).split("|");
  return {
    name: (nameRaw || "current").trim(),
    pathName: (pathNameRaw || "/v1/epub/from-transcript").trim(),
    pipelineVariant: (pipelineVariantRaw || "").trim() || null,
  };
}

async function loadSamples(cfg) {
  const samples = [];

  for (const transcriptPath of cfg.transcripts) {
    const transcriptText = await fs.readFile(transcriptPath, "utf8");
    const baseName = path.basename(transcriptPath, path.extname(transcriptPath));
    samples.push({
      id: slugify(baseName),
      file: transcriptPath,
      title: baseName,
      language: "zh-CN",
      transcriptText,
      notes: "Direct transcript file",
    });
  }

  if (cfg.transcriptManifest) {
    const manifestPath = cfg.transcriptManifest;
    const manifestDir = path.dirname(manifestPath);
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const manifestSamples = Array.isArray(parsed?.samples) ? parsed.samples : [];
    for (const item of manifestSamples) {
      if (!item?.file) continue;
      const transcriptPath = path.resolve(manifestDir, item.file);
      const transcriptText = await fs.readFile(transcriptPath, "utf8");
      samples.push({
        id: String(item.id || `manifest:${item.file}`),
        file: transcriptPath,
        title: String(item.title || path.basename(item.file)),
        language: String(item.language || "zh-CN"),
        transcriptText,
        notes: String(item.notes || ""),
      });
    }
  }

  if (samples.length === 0) {
    throw new Error("No transcripts supplied. Use --transcript or --transcript-manifest.");
  }

  return samples;
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}

async function extractEpub(epubPath, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  await execFileAsync("unzip", ["-q", "-o", epubPath, "-d", destDir]);
}

function stripHtml(input) {
  return String(input)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function readStageSummary(stages) {
  const llmRequestCount = stages.filter((item) => item.stage === "llm_request").length;
  const llmResponseStages = stages.filter((item) => item.stage === "llm_response");
  const normalizationStages = stages.filter((item) => item.stage === "normalization");
  const parseFailures = llmResponseStages.filter((item) => item?.output?.parse_ok === false).length;

  let fullBookSkipped = false;
  let deterministicFallbackChapters = 0;
  let chapterPatchCount = 0;
  let qualityIssueCount = null;
  let qualityWarningCount = null;
  let qualityBlockingCount = null;
  let qualityPassed = null;
  let finalChapterCount = null;

  for (const stage of llmResponseStages) {
    if (stage?.output?.full_book_skipped === true) {
      fullBookSkipped = true;
    }
    deterministicFallbackChapters = Math.max(
      deterministicFallbackChapters,
      Number(stage?.output?.deterministic_fallback_chapters ?? 0),
    );
    chapterPatchCount = Math.max(chapterPatchCount, Number(stage?.output?.patched_chapters ?? 0));
  }

  for (const stage of normalizationStages) {
    if (stage?.output?.quality_issue_count != null) {
      qualityIssueCount = Number(stage.output.quality_issue_count);
    }
    if (stage?.output?.quality_warning_count != null) {
      qualityWarningCount = Number(stage.output.quality_warning_count);
    }
    if (stage?.output?.quality_blocking_count != null) {
      qualityBlockingCount = Number(stage.output.quality_blocking_count);
    }
    if (stage?.output?.quality_passed != null) {
      qualityPassed = Boolean(stage.output.quality_passed);
    }
    if (stage?.output?.final_chapters != null) {
      finalChapterCount = Number(stage.output.final_chapters);
    }
    deterministicFallbackChapters = Math.max(
      deterministicFallbackChapters,
      Number(stage?.input?.chapter_patch_deterministic_fallback_count ?? 0),
    );
  }

  return {
    llmRequestCount,
    parseFailures,
    fullBookSkipped,
    deterministicFallbackChapters,
    chapterPatchCount,
    qualityIssueCount,
    qualityWarningCount,
    qualityBlockingCount,
    qualityPassed,
    finalChapterCount,
  };
}

function collectChapterTitles(navText) {
  return Array.from(navText.matchAll(/<a href="chap_\d+\.xhtml">([\s\S]*?)<\/a>/g)).map((match) =>
    stripHtml(match[1]),
  );
}

function countMatches(text, pattern) {
  return (String(text).match(pattern) ?? []).length;
}

function detectAdjacentDuplicateTitles(titles) {
  const normalize = (title) =>
    String(title)
      .replace(/^第\s*\d+\s*章[:：]?\s*/u, "")
      .replace(/\s*[（(][^（）()]*[）)]\s*$/u, "")
      .trim();

  let previous = "";
  for (const title of titles) {
    const current = normalize(title);
    if (current && current === previous) {
      return true;
    }
    previous = current;
  }
  return false;
}

function computeContentMetrics({ combinedText, chapterTitles }) {
  const weirdTitlePatterns = /(这件事情|件事情|交媒体|好了|的时候|为什么|但是|拜拜|什么东西变贵了)/;
  const badActionPatterns = /(改写成 3 步执行清单|从本章引用中挑 1 条证据|验证“.*”是否成立)/g;
  const placeholderPatterns = /(未在原文中明确说明|关键观点 \d|围绕“.+”的关键观点|讨论背景：|核心概念：)/g;
  const timestampPatterns = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

  return {
    titleSlashCount: chapterTitles.filter((title) => title.includes("/")).length,
    weirdTitleCount: chapterTitles.filter((title) => weirdTitlePatterns.test(title)).length,
    adjacentDuplicateTitles: detectAdjacentDuplicateTitles(chapterTitles),
    boilerplateActionCount: countMatches(combinedText, badActionPatterns),
    placeholderCount: countMatches(combinedText, placeholderPatterns),
    timestampCount: countMatches(combinedText, timestampPatterns),
    totalChars: combinedText.length,
  };
}

async function extractArtifactMetrics(epubPath, extractionDir) {
  await extractEpub(epubPath, extractionDir);
  const oebpsDir = path.join(extractionDir, "OEBPS");
  const navPath = path.join(oebpsDir, "nav.xhtml");
  const navText = await fs.readFile(navPath, "utf8");
  const chapterTitles = collectChapterTitles(navText);

  const chapterFiles = (await fs.readdir(oebpsDir))
    .filter((name) => /^chap_\d+\.xhtml$/.test(name))
    .sort((left, right) => left.localeCompare(right));

  const chapterTexts = [];
  for (const fileName of chapterFiles) {
    const filePath = path.join(oebpsDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    chapterTexts.push({
      fileName,
      raw,
      text: stripHtml(raw),
    });
  }

  const combinedText = chapterTexts.map((item) => item.text).join("\n\n");
  const contentMetrics = computeContentMetrics({ combinedText, chapterTitles });

  return {
    chapterTitles,
    chapterTexts,
    combinedText,
    contentMetrics,
  };
}

function summarizeVariantResult({ sample, variant, response, durationMs, artifactMetrics }) {
  const stages = Array.isArray(response?.stages) ? response.stages : [];
  const stageSummary = readStageSummary(stages);

  return {
    sampleId: sample.id,
    sampleTitle: sample.title,
    variant: variant.name,
    endpoint: variant.pathName,
    pipelineVariant: variant.pipelineVariant,
    durationMs,
    jobId: response?.job_id ?? null,
    stageCount: stages.length,
    ...stageSummary,
    chapterTitleCount: artifactMetrics.chapterTitles.length,
    ...artifactMetrics.contentMetrics,
  };
}

function renderIndexPage(runId, results) {
  const groups = new Map();
  for (const result of results) {
    const bucket = groups.get(result.sample.id) ?? [];
    bucket.push(result);
    groups.set(result.sample.id, bucket);
  }

  const sections = Array.from(groups.entries())
    .map(([sampleId, items]) => {
      const sample = items[0].sample;
      const rows = items
        .map((item) => {
          const summary = item.summary;
          return `<tr>
            <td>${escapeHtml(summary.variant)}</td>
            <td>${escapeHtml(String(summary.durationMs))}</td>
            <td>${escapeHtml(String(summary.llmRequestCount))}</td>
            <td>${escapeHtml(String(summary.parseFailures))}</td>
            <td>${escapeHtml(String(summary.deterministicFallbackChapters))}</td>
            <td>${escapeHtml(String(summary.qualityIssueCount))}</td>
            <td>${escapeHtml(String(summary.placeholderCount))}</td>
            <td>${escapeHtml(String(summary.boilerplateActionCount))}</td>
            <td>${escapeHtml(String(summary.weirdTitleCount))}</td>
            <td><a href="${escapeHtml(item.pageName)}">details</a></td>
          </tr>`;
        })
        .join("\n");

      return `<section class="card">
        <h2>${escapeHtml(sample.title)}</h2>
        <p class="meta">${escapeHtml(sample.file)}</p>
        <table>
          <thead>
            <tr>
              <th>Variant</th>
              <th>ms</th>
              <th>LLM req</th>
              <th>Parse fail</th>
              <th>Fallback ch</th>
              <th>Quality issues</th>
              <th>Placeholders</th>
              <th>Action boilerplate</th>
              <th>Weird titles</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pipeline Eval ${escapeHtml(runId)}</title>
    <style>
      body { font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f4f7fb; color: #1f2f48; }
      main { max-width: 1200px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
      .card { background: white; border: 1px solid #d9e1ef; border-radius: 12px; padding: 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border-bottom: 1px solid #e5ebf5; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f7faff; }
      a { color: #0a5bd8; }
      .meta { color: #52627f; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Pipeline Evaluation</h1>
        <p class="meta">Run ID: ${escapeHtml(runId)}</p>
        <p class="meta">This report compares named pipeline variants using direct EPUB output plus inspector metrics.</p>
      </section>
      ${sections}
    </main>
  </body>
</html>`;
}

function renderDetailPage(result) {
  const { sample, variant, response, artifactMetrics, summary } = result;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(sample.title)} · ${escapeHtml(variant.name)}</title>
    <style>
      body { font-family: Menlo, Monaco, Consolas, monospace; margin: 0; background: #f5f7fb; color: #1c2740; }
      main { max-width: 1200px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
      .card { background: #fff; border: 1px solid #dae3f2; border-radius: 12px; padding: 14px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f6f9ff; border: 1px solid #dde6f6; border-radius: 8px; padding: 10px; margin: 0; }
      h1,h2,h3 { margin: 0 0 8px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>${escapeHtml(sample.title)} · ${escapeHtml(variant.name)}</h1>
        <pre>${escapeHtml(prettyJson(summary))}</pre>
      </section>
      <section class="card">
        <h2>Response</h2>
        <pre>${escapeHtml(prettyJson(response))}</pre>
      </section>
      <section class="card">
        <h2>Chapter Titles</h2>
        <pre>${escapeHtml(artifactMetrics.chapterTitles.join("\n"))}</pre>
      </section>
      <section class="card">
        <h2>Combined EPUB Text</h2>
        <pre>${escapeHtml(artifactMetrics.combinedText)}</pre>
      </section>
    </main>
  </body>
</html>`;
}

async function runVariantOnSample({ cfg, sample, variant, runDir }) {
  const sampleDir = path.join(runDir, slugify(sample.id));
  const variantDir = path.join(sampleDir, slugify(variant.name));
  await fs.mkdir(variantDir, { recursive: true });

  const requestBody = {
    title: sample.title,
    language: sample.language,
    transcript_text: sample.transcriptText,
    template_id: "templateA-v0-book",
    metadata: {
      episode_url: `https://example.com/eval/${encodeURIComponent(sample.id)}`,
      pipeline_variant: variant.pipelineVariant ?? undefined,
    },
    compliance_declaration: {
      for_personal_or_authorized_use_only: true,
      no_commercial_use: true,
    },
  };

  const startedAt = Date.now();
  const response = await apiRequest({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    pathName: variant.pathName,
    method: "POST",
    body: requestBody,
  });
  const durationMs = Date.now() - startedAt;

  await fs.writeFile(path.join(variantDir, "response.json"), JSON.stringify(response, null, 2), "utf8");

  const epubArtifact = Array.isArray(response?.artifacts)
    ? response.artifacts.find((item) => item.type === "epub")
    : null;
  if (!epubArtifact?.download_url) {
    throw new Error(`Variant ${variant.name} did not return inline EPUB artifact metadata.`);
  }

  const epubPath = path.join(variantDir, `${slugify(sample.id)}-${slugify(variant.name)}.epub`);
  await downloadFile(epubArtifact.download_url, epubPath);

  const extractionDir = path.join(variantDir, "epub");
  const artifactMetrics = await extractArtifactMetrics(epubPath, extractionDir);
  await fs.writeFile(path.join(variantDir, "combined-text.txt"), artifactMetrics.combinedText, "utf8");

  const summary = summarizeVariantResult({
    sample,
    variant,
    response,
    durationMs,
    artifactMetrics,
  });
  await fs.writeFile(path.join(variantDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const pageName = `${slugify(sample.id)}-${slugify(variant.name)}.html`;
  await fs.writeFile(path.join(runDir, pageName), renderDetailPage({ sample, variant, response, artifactMetrics, summary }), "utf8");

  return {
    sample,
    variant,
    response,
    artifactMetrics,
    summary,
    pageName,
  };
}

async function ensureHealthz(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`);
  if (!response.ok) {
    throw new Error(`Backend health check failed: ${response.status}`);
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const samples = await loadSamples(cfg);
  const variants = cfg.variants.map(parseVariant);

  await ensureHealthz(cfg.baseUrl);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(cfg.outDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const results = [];
  for (const sample of samples) {
    for (const variant of variants) {
      // eslint-disable-next-line no-console
      console.log(`Running sample=${sample.id} variant=${variant.name}`);
      const result = await runVariantOnSample({ cfg, sample, variant, runDir });
      results.push(result);
    }
  }

  await fs.writeFile(path.join(runDir, "index.html"), renderIndexPage(runId, results), "utf8");
  await fs.writeFile(
    path.join(runDir, "run-summary.json"),
    JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        baseUrl: cfg.baseUrl,
        variants,
        samples: samples.map((sample) => ({
          id: sample.id,
          title: sample.title,
          file: sample.file,
          language: sample.language,
        })),
        results: results.map((item) => item.summary),
      },
      null,
      2,
    ),
    "utf8",
  );

  // eslint-disable-next-line no-console
  console.log(`Done. Open ${path.join(runDir, "index.html")}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
