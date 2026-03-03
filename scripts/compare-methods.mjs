#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const METHOD_OPTIONS = [
  { code: "A", label: "Method A · Parser/Rule First (No LLM Merge)" },
  { code: "B", label: "Method B · Semantic Plan + LLM Merge" },
  { code: "C", label: "Method C · Strict Template-A Prompt + Merge" },
];

const METHOD_CODE_SET = new Set(METHOD_OPTIONS.map((item) => item.code));
const FOCUS_MODES = new Set(["full", "head", "middle", "tail"]);

function printUsage() {
  const usage = [
    "Usage: node scripts/compare-methods.mjs --transcript /path/to/transcript.txt [options]",
    "",
    "Options:",
    "  --methods A,B,C       Methods to run (default: A,B,C)",
    "  --focus MODE          Transcript focus: full | head | middle | tail (default: full)",
    "  --window-lines N      Line window when focus != full (default: 180)",
    "  --max-chars N         Max chars after focus selection (default: unlimited)",
    "  --skip-diff           Skip generating diff-highlight.html",
    "  --base-url URL        API base URL (default: http://localhost:8080)",
    "  --token TOKEN         Auth token (default: dev:cecilia@example.com)",
    "  --out-dir DIR         Output run directory root",
    "  --help                Show this help",
  ].join("\n");
  // eslint-disable-next-line no-console
  console.log(usage);
}

function parseMethodCodes(raw) {
  if (!raw) return METHOD_OPTIONS.map((item) => item.code);
  const parts = String(raw)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (!parts.length) {
    return METHOD_OPTIONS.map((item) => item.code);
  }
  const unique = Array.from(new Set(parts));
  const invalid = unique.filter((code) => !METHOD_CODE_SET.has(code));
  if (invalid.length) {
    throw new Error(`Invalid --methods value. Unsupported method code(s): ${invalid.join(", ")}`);
  }
  return unique;
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:8080",
    token: "dev:cecilia@example.com",
    language: "zh-CN",
    title: "Method Comparison Episode",
    episodeUrl: "https://example.com/episodes/method-compare",
    outDir: path.resolve(process.cwd(), "tasks/method-compare"),
    methods: METHOD_OPTIONS.map((item) => item.code),
    focus: "full",
    windowLines: 180,
    maxChars: null,
    skipDiff: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--skip-diff") {
      out.skipDiff = true;
      continue;
    }
    if (arg === "--transcript" && next) {
      out.transcriptPath = next;
      i += 1;
      continue;
    }
    if (arg === "--title" && next) {
      out.title = next;
      i += 1;
      continue;
    }
    if (arg === "--language" && next) {
      out.language = next;
      i += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      out.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--token" && next) {
      out.token = next;
      i += 1;
      continue;
    }
    if (arg === "--episode-url" && next) {
      out.episodeUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--out-dir" && next) {
      out.outDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--methods" && next) {
      out.methods = parseMethodCodes(next);
      i += 1;
      continue;
    }
    if (arg === "--focus" && next) {
      const normalized = next.trim().toLowerCase();
      if (!FOCUS_MODES.has(normalized)) {
        throw new Error(`Invalid --focus value: ${next}. Allowed: full, head, middle, tail`);
      }
      out.focus = normalized;
      i += 1;
      continue;
    }
    if (arg === "--window-lines" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 20) {
        throw new Error("Invalid --window-lines value. Use an integer >= 20.");
      }
      out.windowLines = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === "--max-chars" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 200) {
        throw new Error("Invalid --max-chars value. Use an integer >= 200.");
      }
      out.maxChars = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
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

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function clipTranscriptByChars(text, maxChars, focusMode) {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }
  if (focusMode === "tail") {
    return text.slice(Math.max(0, text.length - maxChars));
  }
  return text.slice(0, maxChars);
}

function selectTranscriptWindow(transcriptText, cfg) {
  const lines = transcriptText.split(/\r?\n/);
  const totalLines = lines.length;
  if (cfg.focus === "full" || totalLines <= cfg.windowLines) {
    const used = clipTranscriptByChars(transcriptText, cfg.maxChars, cfg.focus);
    return {
      usedText: used,
      totalLines,
      selectedLines: totalLines,
      startLine: 1,
      endLine: totalLines,
      focus: cfg.focus,
      maxChars: cfg.maxChars,
      selectedChars: used.length,
      totalChars: transcriptText.length,
    };
  }

  const window = Math.min(cfg.windowLines, totalLines);
  let startLine = 1;
  if (cfg.focus === "head") {
    startLine = 1;
  } else if (cfg.focus === "tail") {
    startLine = totalLines - window + 1;
  } else {
    const middle = Math.floor((totalLines + 1) / 2);
    startLine = Math.max(1, middle - Math.floor(window / 2));
    if (startLine + window - 1 > totalLines) {
      startLine = Math.max(1, totalLines - window + 1);
    }
  }
  const endLine = Math.min(totalLines, startLine + window - 1);
  const selectedText = lines.slice(startLine - 1, endLine).join("\n");
  const used = clipTranscriptByChars(selectedText, cfg.maxChars, cfg.focus);
  return {
    usedText: used,
    totalLines,
    selectedLines: endLine - startLine + 1,
    startLine,
    endLine,
    focus: cfg.focus,
    maxChars: cfg.maxChars,
    selectedChars: used.length,
    totalChars: transcriptText.length,
  };
}

function toNullableNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function lastValue(stages, picker) {
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const value = picker(stages[index]);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function extractQualitySignals(inspector) {
  const normalizationStages = extractStage(inspector, "normalization");
  const llmStages = extractStage(inspector, "llm_response");
  const qualityPassed = lastValue(normalizationStages, (stage) => {
    if (typeof stage?.output?.quality_passed === "boolean") {
      return stage.output.quality_passed;
    }
    return undefined;
  });
  const qualityIssueCount = lastValue(normalizationStages, (stage) =>
    toNullableNumber(stage?.output?.quality_issue_count),
  );
  const qualityBlockingCount = lastValue(normalizationStages, (stage) =>
    toNullableNumber(stage?.output?.quality_blocking_count),
  );
  const chapterCount = lastValue(normalizationStages, (stage) => {
    const finalChapters = toNullableNumber(stage?.output?.final_chapters);
    if (finalChapters != null) return finalChapters;
    return toNullableNumber(stage?.output?.chapter_count);
  });
  const llmParseOk = lastValue(llmStages, (stage) => {
    if (typeof stage?.output?.parse_ok === "boolean") {
      return stage.output.parse_ok;
    }
    return undefined;
  });
  return {
    qualityPassed,
    qualityIssueCount,
    qualityBlockingCount,
    chapterCount,
    llmParseOk,
  };
}

function classifyMarkdownRows(results) {
  const lineCounts = new Map();
  for (const result of results) {
    const lines = String(result.markdownText ?? "").split("\n");
    const unique = new Set(lines);
    for (const line of unique) {
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  return results.map((result) => {
    const lines = String(result.markdownText ?? "").split("\n");
    const rows = lines.map((line) => {
      const seenCount = lineCounts.get(line) ?? 1;
      let cls = "common";
      if (seenCount === 1) cls = "only";
      if (seenCount > 1 && seenCount < results.length) cls = "partial";
      return { line, cls };
    });
    return { result, rows };
  });
}

function renderDiffHighlightPage(runId, results) {
  const rowsByMethod = classifyMarkdownRows(results);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Method Diff ${escapeHtml(runId)}</title>
    <style>
      body { margin: 0; background: #f3f6fb; color: #1d2a44; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; }
      main { padding: 14px; display: grid; gap: 10px; }
      .card { background: #fff; border: 1px solid #d8e2f1; border-radius: 10px; padding: 12px; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
      @media (min-width: 1200px) { .grid { grid-template-columns: 1fr 1fr 1fr; } }
      .legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
      .pill { padding: 2px 8px; border-radius: 999px; border: 1px solid #cbd6ea; }
      .only { background: #e8fff1; }
      .partial { background: #fff9d9; }
      .common { background: #ffffff; }
      .pane { border: 1px solid #dbe4f4; border-radius: 8px; overflow: hidden; }
      .pane-header { background: #f4f8ff; border-bottom: 1px solid #dbe4f4; padding: 8px; font-weight: 600; font-size: 13px; }
      .content { max-height: 70vh; overflow: auto; font-family: Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.45; }
      .line { white-space: pre-wrap; word-break: break-word; border-bottom: 1px dashed #edf1f8; padding: 2px 8px; }
      .line.only { background: #e8fff1; }
      .line.partial { background: #fff9d9; }
      .line.common { background: #ffffff; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Markdown Diff Highlight</h1>
        <p><strong>Run ID:</strong> ${escapeHtml(runId)}</p>
        <div class="legend">
          <span class="pill only">only: only this method has this line</span>
          <span class="pill partial">partial: appears in some methods</span>
          <span class="pill common">common: appears in all methods</span>
        </div>
      </section>
      <section class="card grid">
        ${rowsByMethod
          .map(
            ({ result, rows }) => `<div class="pane">
              <div class="pane-header">${escapeHtml(result.methodLabel)}</div>
              <div class="content">
                ${rows.map((row) => `<div class="line ${row.cls}">${escapeHtml(row.line)}</div>`).join("\n")}
              </div>
            </div>`,
          )
          .join("\n")}
      </section>
    </main>
  </body>
</html>`;
}

async function apiRequest({ baseUrl, token, pathName, method = "GET", body, retries = 2, retryDelayMs = 1200 }) {
  const url = `${baseUrl.replace(/\/$/, "")}${pathName}`;
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await fetch(url, {
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
        const message = `HTTP ${response.status} ${method} ${pathName}: ${prettyJson(payload)}`;
        const maybeRetriable = response.status >= 500 || response.status === 429;
        if (!maybeRetriable || attempt > retries) {
          throw new Error(message);
        }
        lastError = new Error(message);
        await sleep(retryDelayMs);
        continue;
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt > retries) {
        break;
      }
      await sleep(retryDelayMs);
    }
  }

  throw new Error(normalizeError(lastError));
}

async function pollJob({ baseUrl, token, jobId, maxAttempts = 120 }) {
  const snapshots = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await apiRequest({
      baseUrl,
      token,
      pathName: `/v1/jobs/${jobId}`,
    });
    snapshots.push(status);
    if (status.status === "succeeded" || status.status === "failed" || status.status === "canceled") {
      return { status, snapshots };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Job polling timeout for ${jobId}`);
}

function extractStage(inspector, stageName) {
  if (!inspector?.stages?.length) return [];
  return inspector.stages.filter((item) => item.stage === stageName);
}

function inferDegradedReasons(inspector, methodCode) {
  const reasons = [];
  if (methodCode === "A") {
    return reasons;
  }
  const llmResponses = extractStage(inspector, "llm_response");
  const parseFailed = llmResponses.some((stage) => stage?.output?.parse_ok === false);
  const patchedRetry = llmResponses.some((stage) => {
    const patchedChapters = Number(stage?.output?.patched_chapters ?? 0);
    if (patchedChapters <= 0) return false;
    const notes = String(stage?.notes ?? "").toLowerCase();
    return notes.includes("retry") || notes.includes("fallback");
  });
  if (parseFailed) reasons.push("llm_parse_failed_or_aborted");
  if (patchedRetry) reasons.push("chapter_patch_retry_used");
  return reasons;
}

function renderMethodPage(result) {
  const llmRequests = extractStage(result.inspector, "llm_request");
  const llmResponses = extractStage(result.inspector, "llm_response");
  const degradedText = result.degraded ? `YES (${result.degradedReasons.join(", ") || "unknown"})` : "NO";
  const qualityPassed = result.quality?.qualityPassed;
  const qualityText = qualityPassed == null ? "unknown" : qualityPassed ? "passed" : "failed";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(result.methodLabel)} 对比结果</title>
    <style>
      body { font-family: Menlo, Monaco, Consolas, monospace; margin: 0; background: #f6f8fb; color: #1b2740; }
      main { max-width: 1200px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
      .card { background: #fff; border: 1px solid #dce4f1; border-radius: 12px; padding: 14px; }
      h1,h2,h3 { margin: 0 0 8px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f5f8ff; border: 1px solid #dbe5ff; border-radius: 8px; padding: 10px; margin: 0; }
      .meta { display: grid; gap: 6px; font-size: 13px; color: #4a5874; }
      a { color: #0a5bd8; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>${escapeHtml(result.methodLabel)}</h1>
        <div class="meta">
          <div><strong>Method code:</strong> ${escapeHtml(result.methodCode)}</div>
          <div><strong>Job ID:</strong> ${escapeHtml(result.createResponse?.job_id || "-")}</div>
          <div><strong>Final status:</strong> ${escapeHtml(result.finalStatus?.status || "unknown")}</div>
          <div><strong>Degraded:</strong> ${escapeHtml(degradedText)}</div>
          <div><strong>Attempts:</strong> ${escapeHtml(String(result.attempts ?? 1))}</div>
          <div><strong>Quality gate:</strong> ${escapeHtml(qualityText)}</div>
          <div><strong>Quality issues:</strong> ${escapeHtml(String(result.quality?.qualityIssueCount ?? "n/a"))}</div>
          <div><strong>Blocking issues:</strong> ${escapeHtml(String(result.quality?.qualityBlockingCount ?? "n/a"))}</div>
          <div><strong>Chapter count:</strong> ${escapeHtml(String(result.quality?.chapterCount ?? "n/a"))}</div>
          <div><strong>LLM parse_ok:</strong> ${escapeHtml(String(result.quality?.llmParseOk ?? "n/a"))}</div>
          <div><strong>EPUB:</strong> ${result.epubUrl ? `<a href="${escapeHtml(result.epubUrl)}" target="_blank">download</a>` : "N/A"}</div>
          <div><strong>MD artifact:</strong> ${result.mdUrl ? `<a href="${escapeHtml(result.mdUrl)}" target="_blank">open</a>` : "N/A"}</div>
        </div>
      </section>
      ${
        result.error
          ? `<section class="card">
        <h2>0) Method Error</h2>
        <pre>${escapeHtml(result.error)}</pre>
      </section>`
          : ""
      }

      <section class="card">
        <h2>1) Create API Request Payload</h2>
        <pre>${escapeHtml(prettyJson(result.createRequest))}</pre>
      </section>

      <section class="card">
        <h2>2) Create API Response Payload</h2>
        <pre>${escapeHtml(prettyJson(result.createResponse))}</pre>
      </section>

      <section class="card">
        <h2>3) Inspector Payload (Full)</h2>
        <pre>${escapeHtml(prettyJson(result.inspector))}</pre>
      </section>

      <section class="card">
        <h2>4) LLM Request Stage Payload</h2>
        <pre>${escapeHtml(prettyJson(llmRequests))}</pre>
      </section>

      <section class="card">
        <h2>5) LLM Response Stage Payload</h2>
        <pre>${escapeHtml(prettyJson(llmResponses))}</pre>
      </section>

      <section class="card">
        <h2>6) Ebook Content (Markdown Artifact)</h2>
        <pre>${escapeHtml(result.markdownText || "(no markdown artifact)")}</pre>
      </section>
    </main>
  </body>
</html>`;
}

function renderIndexPage(runId, results, cfg, transcriptWindow) {
  const links = results
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.pageName)}">${escapeHtml(item.methodLabel)}</a> · status=${escapeHtml(item.finalStatus?.status || "unknown")} · degraded=${escapeHtml(item.degraded ? "yes" : "no")} · quality=${escapeHtml(String(item.quality?.qualityPassed ?? "unknown"))}</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Method Comparison ${escapeHtml(runId)}</title>
    <style>
      body { font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f4f7fb; color: #1f2f48; }
      main { max-width: 900px; margin: 0 auto; padding: 20px; }
      .card { background: white; border: 1px solid #d9e1ef; border-radius: 12px; padding: 14px; }
      a { color: #0a5bd8; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Method Comparison Run</h1>
        <p><strong>Run ID:</strong> ${escapeHtml(runId)}</p>
        <p><strong>Methods:</strong> ${escapeHtml(cfg.methods.join(", "))}</p>
        <p><strong>Transcript focus:</strong> ${escapeHtml(transcriptWindow.focus)} (line ${transcriptWindow.startLine}-${transcriptWindow.endLine}, chars=${transcriptWindow.selectedChars}/${transcriptWindow.totalChars})</p>
        <p><strong>Artifacts:</strong> <a href="diff-highlight.html">diff-highlight.html</a> · <a href="run-summary.json">run-summary.json</a></p>
        <ol>${links}</ol>
      </section>
    </main>
  </body>
</html>`;
}

async function runMethodOnce({ cfg, method, transcriptText }) {
  const iterationScope =
    cfg.focus === "full"
      ? "full"
      : `${cfg.focus} lines ${cfg.transcriptWindow.startLine}-${cfg.transcriptWindow.endLine}`;
  const createRequest = {
    title: cfg.title,
    language: cfg.language,
    transcript_text: transcriptText,
    template_id: "templateA-v0-book",
    output_formats: ["epub", "md"],
    metadata: {
      episode_url: cfg.episodeUrl,
      generation_method: method.code,
      iteration_scope: iterationScope,
      iteration_max_chars: cfg.maxChars,
    },
    compliance_declaration: {
      for_personal_or_authorized_use_only: true,
      no_commercial_use: true,
    },
  };

  const createResponse = await apiRequest({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    pathName: "/v1/jobs/from-transcript",
    method: "POST",
    body: createRequest,
  });

  const jobId = createResponse.job_id;
  const { status: finalStatus, snapshots } = await pollJob({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    jobId,
  });

  const inspector = await apiRequest({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    pathName: `/v1/jobs/${jobId}/inspector`,
  });

  let artifacts = null;
  try {
    artifacts = await apiRequest({
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      pathName: `/v1/jobs/${jobId}/artifacts`,
    });
  } catch {
    artifacts = null;
  }

  const mdItem = artifacts?.artifacts?.find((item) => item.type === "md");
  const epubItem = artifacts?.artifacts?.find((item) => item.type === "epub");

  let markdownText = "";
  if (mdItem?.download_url) {
    try {
      const mdRes = await fetch(mdItem.download_url);
      markdownText = mdRes.ok ? await mdRes.text() : "";
    } catch (error) {
      markdownText = `[markdown fetch failed] ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const degradedReasons = inferDegradedReasons(inspector, method.code);
  const quality = extractQualitySignals(inspector);
  const result = {
    methodCode: method.code,
    methodLabel: method.label,
    createRequest,
    createResponse,
    snapshots,
    finalStatus,
    inspector,
    artifacts,
    markdownText,
    mdUrl: mdItem?.download_url ?? null,
    epubUrl: epubItem?.download_url ?? null,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    quality,
    error: null,
  };

  return result;
}

async function runMethod({ cfg, method, transcriptText, runDir }) {
  const maxAttempts = method.code === "C" ? 3 : 1;
  let lastError = null;
  let result = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const candidate = await runMethodOnce({ cfg, method, transcriptText });
      candidate.attempts = attempt;
      if (attempt > 1) {
        candidate.degraded = true;
        candidate.degradedReasons = [...new Set([...(candidate.degradedReasons ?? []), "request_retry_recovered"])];
      }
      result = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-console
        console.log(`Retrying ${method.code} (attempt ${attempt + 1}/${maxAttempts}) after: ${normalizeError(error)}`);
        await sleep(1200);
      }
    }
  }

  if (!result) {
    result = {
      methodCode: method.code,
      methodLabel: method.label,
      createRequest: {
        title: cfg.title,
        language: cfg.language,
        template_id: "templateA-v0-book",
        output_formats: ["epub", "md"],
        metadata: {
          episode_url: cfg.episodeUrl,
          generation_method: method.code,
        },
      },
      createResponse: null,
      snapshots: [],
      finalStatus: { status: "failed" },
      inspector: null,
      artifacts: null,
      markdownText: "",
      mdUrl: null,
      epubUrl: null,
      degraded: true,
      degradedReasons: ["method_request_failed"],
      quality: {
        qualityPassed: null,
        qualityIssueCount: null,
        qualityBlockingCount: null,
        chapterCount: null,
        llmParseOk: null,
      },
      attempts: maxAttempts,
      error: normalizeError(lastError),
    };
  }

  const pageName = `method-${method.code}.html`;
  await fs.writeFile(path.join(runDir, pageName), renderMethodPage(result), "utf8");
  await fs.writeFile(path.join(runDir, `method-${method.code}.json`), JSON.stringify(result, null, 2), "utf8");

  return { ...result, pageName };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    printUsage();
    return;
  }
  if (!cfg.transcriptPath) {
    throw new Error("Missing required arg --transcript /path/to/transcript.txt");
  }

  const transcriptText = await fs.readFile(cfg.transcriptPath, "utf8");
  const transcriptWindow = selectTranscriptWindow(transcriptText, cfg);
  cfg.transcriptWindow = transcriptWindow;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(cfg.outDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  await fs.writeFile(path.join(runDir, "transcript-source.txt"), transcriptText, "utf8");
  await fs.writeFile(path.join(runDir, "transcript-used.txt"), transcriptWindow.usedText, "utf8");
  await fs.writeFile(
    path.join(runDir, "run-config.json"),
    JSON.stringify(
      {
        runId,
        transcriptPath: cfg.transcriptPath,
        transcriptWindow: {
          focus: transcriptWindow.focus,
          totalLines: transcriptWindow.totalLines,
          selectedLines: transcriptWindow.selectedLines,
          startLine: transcriptWindow.startLine,
          endLine: transcriptWindow.endLine,
          totalChars: transcriptWindow.totalChars,
          selectedChars: transcriptWindow.selectedChars,
          maxChars: transcriptWindow.maxChars,
        },
        methods: cfg.methods,
        baseUrl: cfg.baseUrl,
        title: cfg.title,
        language: cfg.language,
      },
      null,
      2,
    ),
    "utf8",
  );

  const methods = cfg.methods
    .map((code) => METHOD_OPTIONS.find((item) => item.code === code))
    .filter((item) => Boolean(item));
  if (!methods.length) {
    throw new Error("No methods selected to run.");
  }

  const results = [];
  for (const method of methods) {
    // eslint-disable-next-line no-console
    console.log(`Running ${method.code}...`);
    const result = await runMethod({ cfg, method, transcriptText: transcriptWindow.usedText, runDir });
    results.push(result);
  }

  await fs.writeFile(path.join(runDir, "index.html"), renderIndexPage(runId, results, cfg, transcriptWindow), "utf8");

  if (!cfg.skipDiff && results.length >= 2) {
    await fs.writeFile(path.join(runDir, "diff-highlight.html"), renderDiffHighlightPage(runId, results), "utf8");
  }

  await fs.writeFile(
    path.join(runDir, "run-summary.json"),
    JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        transcriptPath: cfg.transcriptPath,
        transcriptWindow: {
          focus: transcriptWindow.focus,
          totalLines: transcriptWindow.totalLines,
          selectedLines: transcriptWindow.selectedLines,
          startLine: transcriptWindow.startLine,
          endLine: transcriptWindow.endLine,
          totalChars: transcriptWindow.totalChars,
          selectedChars: transcriptWindow.selectedChars,
          maxChars: transcriptWindow.maxChars,
        },
        baseUrl: cfg.baseUrl,
        methods: results.map((item) => ({
          method: item.methodCode,
          jobId: item.createResponse?.job_id,
          status: item.finalStatus?.status,
          degraded: item.degraded,
          degraded_reasons: item.degradedReasons,
          attempts: item.attempts,
          quality: item.quality,
          error: item.error,
          page: item.pageName,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  // eslint-disable-next-line no-console
  console.log(`Done. Open: ${path.join(runDir, "index.html")}`);
  if (!cfg.skipDiff && results.length >= 2) {
    // eslint-disable-next-line no-console
    console.log(`Diff: ${path.join(runDir, "diff-highlight.html")}`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
