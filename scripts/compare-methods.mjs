#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:8080",
    token: "dev:cecilia@example.com",
    language: "zh-CN",
    title: "Method Comparison Episode",
    episodeUrl: "https://example.com/episodes/method-compare",
    outDir: path.resolve(process.cwd(), "tasks/method-compare"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--transcript" && next) out.transcriptPath = next;
    if (arg === "--title" && next) out.title = next;
    if (arg === "--language" && next) out.language = next;
    if (arg === "--base-url" && next) out.baseUrl = next;
    if (arg === "--token" && next) out.token = next;
    if (arg === "--episode-url" && next) out.episodeUrl = next;
    if (arg === "--out-dir" && next) out.outDir = path.resolve(next);
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

function renderIndexPage(runId, results) {
  const links = results
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.pageName)}">${escapeHtml(item.methodLabel)}</a> · status=${escapeHtml(item.finalStatus?.status || "unknown")} · degraded=${escapeHtml(item.degraded ? "yes" : "no")}</li>`,
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
        <ol>${links}</ol>
      </section>
    </main>
  </body>
</html>`;
}

async function runMethodOnce({ cfg, method, transcriptText }) {
  const createRequest = {
    title: cfg.title,
    language: cfg.language,
    transcript_text: transcriptText,
    template_id: "templateA-v0-book",
    output_formats: ["epub", "md"],
    metadata: {
      episode_url: cfg.episodeUrl,
      generation_method: method.code,
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
  if (!cfg.transcriptPath) {
    throw new Error("Missing required arg --transcript /path/to/transcript.txt");
  }

  const transcriptText = await fs.readFile(cfg.transcriptPath, "utf8");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(cfg.outDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const methods = [
    { code: "A", label: "Method A · Parser/Rule First (No LLM Merge)" },
    { code: "B", label: "Method B · Semantic Plan + LLM Merge" },
    { code: "C", label: "Method C · Strict Template-A Prompt + Merge" },
  ];

  const results = [];
  for (const method of methods) {
    // eslint-disable-next-line no-console
    console.log(`Running ${method.code}...`);
    const result = await runMethod({ cfg, method, transcriptText, runDir });
    results.push(result);
  }

  await fs.writeFile(path.join(runDir, "index.html"), renderIndexPage(runId, results), "utf8");
  await fs.writeFile(
    path.join(runDir, "run-summary.json"),
    JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        transcriptPath: cfg.transcriptPath,
        baseUrl: cfg.baseUrl,
        methods: results.map((item) => ({
          method: item.methodCode,
          jobId: item.createResponse?.job_id,
          status: item.finalStatus?.status,
          degraded: item.degraded,
          degraded_reasons: item.degradedReasons,
          attempts: item.attempts,
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
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
