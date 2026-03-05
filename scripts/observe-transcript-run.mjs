#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  host: "127.0.0.1",
  port: 4173,
  baseUrl: "http://localhost:8080",
  token: "dev:cecilia@example.com",
  sampleDir: path.resolve(process.cwd(), "tasks/transcript-samples"),
  dataSampleDir: path.resolve(process.cwd(), "data/transcripts"),
  open: true,
};

const STAGE_EXPLANATIONS = {
  transcript: "Input transcript accepted and metadata captured.",
  normalization: "Text is cleaned, segmented, and transformed into chapter-oriented structure.",
  llm_request: "Prompt + chapter plan sent to the LLM.",
  llm_response: "LLM output parsed and merged with evidence checks.",
  pdf: "PDF renderer stage (optional if PDF requested).",
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--no-open") {
      out.open = false;
      continue;
    }
    if (arg === "--port" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      out.port = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === "--host" && next) {
      out.host = next;
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
    if (arg === "--sample-dir" && next) {
      out.sampleDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--data-sample-dir" && next) {
      out.dataSampleDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log([
    "Usage: node scripts/observe-transcript-run.mjs [options]",
    "",
    "Options:",
    "  --base-url URL      Backend URL (default: http://localhost:8080)",
    "  --token TOKEN       Auth token (default: dev:cecilia@example.com)",
    "  --sample-dir PATH   Local transcript sample directory",
    "  --data-sample-dir PATH  Transcript sample directory from /data",
    "  --host HOST         Dashboard host (default: 127.0.0.1)",
    "  --port PORT         Dashboard port (default: 4173)",
    "  --no-open           Do not auto-open browser",
    "  --help              Show this help",
  ].join("\n"));
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function textResponse(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function previewText(input, maxChars = 260) {
  const flattened = String(input).replace(/\s+/g, " ").trim();
  if (flattened.length <= maxChars) {
    return flattened;
  }
  return `${flattened.slice(0, maxChars - 1)}…`;
}

function createRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execFileAsync("open", [url]);
      return true;
    }
    if (platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
      return true;
    }
    await execFileAsync("xdg-open", [url]);
    return true;
  } catch {
    return false;
  }
}

async function parseLocalSampleManifest(sampleDir) {
  const manifestPath = path.join(sampleDir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.samples) ? parsed.samples : [];
    return rows
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row;
        return {
          id: String(item.id ?? ""),
          file: String(item.file ?? ""),
          title: String(item.title ?? ""),
          language: String(item.language ?? "zh-CN"),
          notes: typeof item.notes === "string" ? item.notes : "",
        };
      })
      .filter((item) => item.id && item.file && item.title);
  } catch {
    return [];
  }
}

async function loadLocalSamples(sampleDir) {
  let files = [];
  try {
    files = await fs.readdir(sampleDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const txtFiles = files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const manifestItems = await parseLocalSampleManifest(sampleDir);
  const manifestByFile = new Map(manifestItems.map((item) => [item.file, item]));

  const samples = [];
  for (const fileName of txtFiles) {
    const fullPath = path.join(sampleDir, fileName);
    const transcriptText = await fs.readFile(fullPath, "utf8");
    const manifest = manifestByFile.get(fileName);
    const id = manifest?.id || `file:${fileName}`;
    const title = manifest?.title || fileName.replace(/\.txt$/i, "");
    const language = manifest?.language || "zh-CN";
    samples.push({
      id,
      source: "local",
      title,
      language,
      char_count: transcriptText.length,
      preview: previewText(transcriptText),
      file_name: fileName,
      file_path: fullPath,
      notes: manifest?.notes || "",
    });
  }
  return samples;
}

async function loadDataSamples(dataSampleDir) {
  let files = [];
  try {
    files = await fs.readdir(dataSampleDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const txtFiles = files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const samples = [];
  for (const fileName of txtFiles) {
    const fullPath = path.join(dataSampleDir, fileName);
    const transcriptText = await fs.readFile(fullPath, "utf8");
    samples.push({
      id: `data:${fileName}`,
      source: "data",
      title: fileName.replace(/\.txt$/i, ""),
      language: "zh-CN",
      char_count: transcriptText.length,
      preview: previewText(transcriptText),
      file_name: fileName,
      file_path: fullPath,
      notes: "Loaded from data/transcripts",
    });
  }

  return samples;
}

async function backendJson(cfg, pathName, options = {}) {
  const response = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${pathName}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${options.method ?? "GET"} ${pathName}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function loadHistorySamples(cfg, limit = 12) {
  try {
    const payload = await backendJson(cfg, `/v1/dev/transcript-samples?limit=${limit}`);
    const rows = Array.isArray(payload?.samples) ? payload.samples : [];
    return rows
      .filter((row) => row && typeof row === "object" && typeof row.job_id === "string")
      .map((row) => ({
        id: `history:${row.job_id}`,
        source: "history",
        job_id: row.job_id,
        title: String(row.title ?? "History Sample"),
        language: String(row.language ?? "zh-CN"),
        created_at: String(row.created_at ?? ""),
        char_count: Number(row.char_count ?? 0),
        preview: String(row.preview ?? ""),
      }));
  } catch (error) {
    return {
      samples: [],
      error: normalizeError(error),
    };
  }
}

async function resolveSampleTranscript(cfg, sampleId) {
  if (!sampleId || typeof sampleId !== "string") {
    throw new Error("sample_id is required.");
  }
  if (sampleId.startsWith("history:")) {
    const jobId = sampleId.slice("history:".length);
    const payload = await backendJson(cfg, `/v1/dev/transcript-samples/${encodeURIComponent(jobId)}`);
    const sample = payload?.sample ?? {};
    return {
      sample_id: sampleId,
      title: String(sample.title ?? `History ${jobId}`),
      language: String(sample.language ?? "zh-CN"),
      transcript_text: String(sample.transcript_text ?? ""),
      char_count: Number(sample.char_count ?? 0),
    };
  }

  const localSamples = await loadLocalSamples(cfg.sampleDir);
  const dataSamples = await loadDataSamples(cfg.dataSampleDir);
  const hit = [...localSamples, ...dataSamples].find((item) => item.id === sampleId);
  if (!hit) {
    throw new Error(`Unknown sample_id: ${sampleId}`);
  }
  const transcriptPath = hit.file_path;
  const transcriptText = await fs.readFile(transcriptPath, "utf8");
  return {
    sample_id: sampleId,
    title: hit.title,
    language: hit.language,
    transcript_text: transcriptText,
    char_count: transcriptText.length,
  };
}

function buildHtmlPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Transcript to EPUB Observatory</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");

      :root {
        --bg: #f4efe6;
        --ink: #1b1d24;
        --muted: #5f5a57;
        --panel: #fffdfa;
        --stroke: #d9ccc0;
        --accent: #c5522b;
        --accent-deep: #872f17;
        --teal: #1f6d72;
        --ok: #178a56;
        --warn: #a36000;
        --fail: #af2434;
        --glow: 0 30px 60px rgba(101, 58, 25, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Manrope", ui-sans-serif, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(900px 500px at 5% -10%, rgba(255, 198, 150, 0.28), transparent 70%),
          radial-gradient(1000px 480px at 100% 0%, rgba(150, 220, 220, 0.2), transparent 72%),
          var(--bg);
      }
      .shell {
        width: min(1340px, 94vw);
        margin: 0 auto;
        padding: 18px 0 36px;
        display: grid;
        gap: 14px;
      }
      .panel {
        border: 1px solid var(--stroke);
        border-radius: 20px;
        padding: 18px;
        background: var(--panel);
        box-shadow: var(--glow);
      }
      .hero { position: relative; overflow: hidden; }
      .hero::after {
        content: "";
        position: absolute;
        width: 420px;
        height: 420px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(197, 82, 43, 0.18), transparent 68%);
        right: -220px;
        top: -240px;
        pointer-events: none;
      }
      h1, h2, h3, h4 { margin: 0; line-height: 1.1; }
      h1 {
        font-family: "Fraunces", serif;
        font-size: clamp(34px, 4.6vw, 58px);
        letter-spacing: 0.4px;
      }
      .hero-sub {
        margin-top: 10px;
        max-width: 860px;
        color: var(--muted);
        font-size: 15px;
      }
      .pills {
        margin-top: 14px;
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(3, minmax(160px, 1fr));
      }
      .pill {
        border: 1px solid var(--stroke);
        border-radius: 12px;
        padding: 10px;
        background: #fff8f2;
      }
      .pill .k {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .pill .v {
        margin-top: 6px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 13px;
      }

      .toolbar {
        display: grid;
        grid-template-columns: 1.4fr 0.5fr auto auto auto;
        gap: 10px;
        align-items: end;
      }
      label {
        display: block;
        margin-bottom: 7px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      select, button {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--stroke);
        background: #fff;
        font: inherit;
        font-size: 14px;
        padding: 11px 12px;
      }
      button {
        cursor: pointer;
        font-weight: 700;
      }
      .btn-run {
        color: #fff;
        background: linear-gradient(130deg, var(--accent), #d27242);
        border-color: transparent;
      }
      .btn-muted {
        background: #fff8f2;
      }
      button:disabled { opacity: 0.55; cursor: wait; }
      .meta-line {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
      }
      .error {
        margin-top: 7px;
        color: var(--fail);
        font-size: 13px;
        white-space: pre-wrap;
      }

      .story-grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 14px;
      }
      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .section-head h2 {
        font-family: "Fraunces", serif;
        font-size: 25px;
      }
      .section-head p {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
      }
      .transcript-meta {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 8px;
      }
      textarea {
        width: 100%;
        min-height: 370px;
        resize: vertical;
        border-radius: 12px;
        border: 1px solid var(--stroke);
        background: #fffcf9;
        padding: 12px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 12px;
        line-height: 1.5;
      }

      .result-shell {
        border: 1px solid var(--stroke);
        border-radius: 16px;
        background: linear-gradient(155deg, #fff7ee 0%, #fff 62%);
        padding: 14px;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--stroke);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.06em;
      }
      .status-pill::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--warn);
      }
      .status-pill.ok::before { background: var(--ok); }
      .status-pill.warn::before { background: var(--warn); }
      .status-pill.fail::before { background: var(--fail); }
      .result-summary {
        margin-top: 11px;
        color: var(--ink);
        font-size: 13px;
      }
      .result-summary b {
        color: var(--muted);
      }
      .artifact-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .artifact-links a {
        text-decoration: none;
        color: #fff;
        background: var(--teal);
        border-radius: 999px;
        padding: 8px 13px;
        font-size: 12px;
        font-weight: 700;
      }
      .preview-title {
        margin: 14px 0 8px;
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        border: 1px solid var(--stroke);
        border-radius: 12px;
        padding: 10px;
        background: #fffcf9;
        max-height: 320px;
        overflow: auto;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 11.5px;
        line-height: 1.46;
      }

      .flow-grid {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(6, minmax(130px, 1fr));
        gap: 8px;
      }
      .flow-node {
        border: 1px solid var(--stroke);
        border-radius: 12px;
        padding: 10px;
        background: #fffcf9;
        min-height: 92px;
      }
      .flow-state {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
      }
      .flow-node .name {
        margin-top: 6px;
        font-weight: 800;
        font-size: 13px;
      }
      .flow-node .desc {
        margin-top: 6px;
        font-size: 11px;
        color: var(--muted);
        line-height: 1.35;
      }
      .flow-node.done {
        border-color: rgba(23, 138, 86, 0.4);
        background: #eff9f3;
      }
      .flow-node.running {
        border-color: rgba(197, 82, 43, 0.5);
        background: #fff1e5;
      }
      .flow-node.pending { opacity: 0.62; }

      .timeline { display: grid; gap: 10px; }
      .timeline-empty {
        color: var(--muted);
        font-size: 13px;
      }
      .stage-card {
        border: 1px solid var(--stroke);
        border-radius: 14px;
        background: #fff;
        padding: 12px;
      }
      .stage-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .stage-card h4 {
        font-family: "Fraunces", serif;
        font-size: 20px;
      }
      .stage-time {
        font-size: 12px;
        color: var(--muted);
        font-family: "IBM Plex Mono", ui-monospace, monospace;
      }
      .stage-desc {
        margin-top: 4px;
        color: var(--muted);
        font-size: 13px;
      }
      .stage-grid {
        margin-top: 9px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .stage-cell {
        border: 1px solid var(--stroke);
        border-radius: 10px;
        background: #fff8f2;
        padding: 8px;
      }
      .stage-cell .k {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .stage-cell .v {
        margin-top: 6px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 11.5px;
        line-height: 1.35;
      }
      details {
        margin-top: 8px;
        border: 1px dashed var(--stroke);
        border-radius: 10px;
        padding: 8px;
        background: #fffcf8;
      }
      summary {
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }

      @media (max-width: 1180px) {
        .pills { grid-template-columns: 1fr; }
        .toolbar { grid-template-columns: 1fr 1fr; }
        .story-grid { grid-template-columns: 1fr; }
        .flow-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
      }
      @media (max-width: 760px) {
        .toolbar { grid-template-columns: 1fr; }
        .stage-grid { grid-template-columns: 1fr; }
        .flow-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel hero">
        <h1>Transcript to EPUB Observatory</h1>
        <p class="hero-sub">Run complete transcript workflows without the black box feeling. Compare input and output quality quickly, and inspect every pipeline stage with explicit evidence.</p>
        <div class="pills">
          <div class="pill">
            <div class="k">Purpose</div>
            <div class="v">See if EPUB quality improved.</div>
          </div>
          <div class="pill">
            <div class="k">Method</div>
            <div class="v">Live stage observability + artifacts.</div>
          </div>
          <div class="pill">
            <div class="k">Audience</div>
            <div class="v">Ceci + research-style collaborators.</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <label for="sampleSelect">Transcript Sample</label>
            <select id="sampleSelect"></select>
          </div>
          <div>
            <label for="methodSelect">Generation Method</label>
            <select id="methodSelect">
              <option value="C">Method C</option>
            </select>
          </div>
          <button id="refreshSamples" class="btn-muted">Refresh Samples</button>
          <button id="runBtn" class="btn-run">Run E2E</button>
        </div>
        <p id="sampleMeta" class="meta-line">Loading samples...</p>
        <p id="sampleError" class="error"></p>
      </section>

      <section>
        <div class="story-grid">
          <article class="panel">
            <div class="section-head">
              <h2>Input Transcript</h2>
              <p>What went in</p>
            </div>
            <p id="inputMeta" class="transcript-meta"></p>
            <textarea id="transcriptPreview" readonly></textarea>
          </article>

          <article class="panel">
            <div class="section-head">
              <h2>Output Check</h2>
              <p>What came out</p>
            </div>
            <div class="result-shell">
              <div id="storyStatusBadge" class="status-pill warn">IDLE</div>
              <div id="storySummary" class="result-summary">Start a run to populate this panel.</div>
              <div id="storyArtifactLinks" class="artifact-links"></div>
              <div class="preview-title">Markdown Preview (first 3200 chars)</div>
              <pre id="storyMdPreview">(run to see output)</pre>
            </div>
          </article>
        </div>

        <article class="panel">
          <div class="section-head">
            <h2>Pipeline Flow</h2>
            <p>Where the run is now</p>
          </div>
          <div id="storyFlow" class="flow-grid"></div>
        </article>

        <article class="panel">
          <div class="section-head">
            <h2>Stage Narrative</h2>
            <p>Why each step happened</p>
          </div>
          <div id="storyTimeline" class="timeline"></div>
        </article>
      </section>
    </main>

    <script>
      const stageExplanations = ${JSON.stringify(STAGE_EXPLANATIONS)};
      const flowOrder = ["transcript", "normalization", "llm_request", "llm_response", "pdf", "render"];
      const queryParams = new URLSearchParams(window.location.search);
      const initialSampleId = queryParams.get("sample") || "";
      const initialMethod = "C";

      const state = {
        samples: [],
        currentRun: null,
        pollTimer: null,
        selectedSampleLabel: "-",
        initSampleId: initialSampleId,
      };

      const sampleSelect = document.getElementById("sampleSelect");
      const methodSelect = document.getElementById("methodSelect");
      const sampleMeta = document.getElementById("sampleMeta");
      const sampleError = document.getElementById("sampleError");
      const inputMeta = document.getElementById("inputMeta");
      const transcriptPreview = document.getElementById("transcriptPreview");
      const runBtn = document.getElementById("runBtn");
      const storyStatusBadge = document.getElementById("storyStatusBadge");
      const storySummary = document.getElementById("storySummary");
      const storyArtifactLinks = document.getElementById("storyArtifactLinks");
      const storyMdPreview = document.getElementById("storyMdPreview");
      const storyFlow = document.getElementById("storyFlow");
      const storyTimeline = document.getElementById("storyTimeline");

      function writeShareableUrl(overrides = {}) {
        const params = new URLSearchParams(window.location.search);
        const next = {
          sample: overrides.sample ?? sampleSelect.value,
          method: overrides.method ?? methodSelect.value,
        };
        for (const [key, value] of Object.entries(next)) {
          if (value) {
            params.set(key, value);
          } else {
            params.delete(key);
          }
        }
        const query = params.toString();
        const nextUrl = query ? window.location.pathname + "?" + query : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
      }

      async function fetchJson(path, options = {}) {
        const response = await fetch(path, options);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload && payload.error ? payload.error : JSON.stringify(payload));
        }
        return payload;
      }

      function summarizeSample(sample) {
        let source = "local";
        if (sample.source === "history") source = "history";
        if (sample.source === "data") source = "data";
        return source + " · " + sample.char_count + " chars" + (sample.created_at ? " · " + sample.created_at : "");
      }

      function shortKeys(record) {
        if (!record || typeof record !== "object") return "-";
        const keys = Object.keys(record).slice(0, 8);
        return keys.length ? keys.join(", ") : "-";
      }

      function statusTone(statusValue) {
        if (statusValue === "succeeded") return "ok";
        if (statusValue === "failed" || statusValue === "canceled") return "fail";
        return "warn";
      }

      function renderSampleOptions() {
        sampleSelect.innerHTML = "";
        for (const sample of state.samples) {
          const option = document.createElement("option");
          option.value = sample.id;
          option.textContent = sample.title + " (" + summarizeSample(sample) + ")";
          sampleSelect.appendChild(option);
        }
      }

      async function loadSampleText(sampleId) {
        const payload = await fetchJson("/api/sample?id=" + encodeURIComponent(sampleId));
        const sample = payload.sample || {};
        state.selectedSampleLabel = sample.title || sampleId;
        transcriptPreview.value = sample.transcript_text || "";
        inputMeta.textContent = state.selectedSampleLabel + " · " + (sample.language || "zh-CN") + " · " + (sample.char_count || 0) + " chars";
        writeShareableUrl({ sample: sampleId });
      }

      async function loadSamples() {
        sampleError.textContent = "";
        sampleMeta.textContent = "Loading samples...";
        const payload = await fetchJson("/api/samples");
        state.samples = payload.samples || [];
        renderSampleOptions();
        sampleMeta.textContent = "Loaded " + state.samples.length + " samples. Pick one and run.";
        if (payload.history_error) {
          sampleError.textContent = "History sample fetch warning: " + payload.history_error;
        }
        if (state.samples.length > 0) {
          const preferredSampleId = state.initSampleId && state.samples.some((item) => item.id === state.initSampleId)
            ? state.initSampleId
            : state.samples[0].id;
          sampleSelect.value = preferredSampleId;
          state.initSampleId = "";
          await loadSampleText(preferredSampleId);
        } else {
          transcriptPreview.value = "";
          inputMeta.textContent = "No sample found. Add .txt files under data/transcripts or tasks/transcript-samples.";
        }
      }

      function renderArtifacts(artifacts) {
        const rows = Array.isArray(artifacts) ? artifacts : [];
        if (!rows.length) {
          storyArtifactLinks.innerHTML = "";
          return;
        }
        storyArtifactLinks.innerHTML = rows
          .map((item) => '<a href="' + item.download_url + '" target="_blank" rel="noreferrer">Download ' + String(item.type || "").toUpperCase() + "</a>")
          .join("");
      }

      function renderFlow(stages, statusValue) {
        storyFlow.innerHTML = "";
        const doneStages = new Set((stages || []).map((stage) => String(stage.stage || "")));
        const runningStage = stages && stages.length ? String(stages[stages.length - 1].stage || "") : "";
        for (const step of flowOrder) {
          const card = document.createElement("article");
          let stateLabel = "pending";
          if (doneStages.has(step)) {
            stateLabel = "done";
          } else if ((statusValue === "queued" || statusValue === "processing") && runningStage === step) {
            stateLabel = "running";
          } else if (step === "render" && statusValue === "succeeded") {
            stateLabel = "done";
          }
          card.className = "flow-node " + stateLabel;
          const desc = stageExplanations[step] || "Pipeline stage";
          card.innerHTML = [
            '<div class="flow-state">' + stateLabel + "</div>",
            '<div class="name">' + step + "</div>",
            '<div class="desc">' + desc + "</div>",
          ].join("");
          storyFlow.appendChild(card);
        }
      }

      function renderTimeline(stages) {
        storyTimeline.innerHTML = "";
        if (!Array.isArray(stages) || stages.length === 0) {
          storyTimeline.innerHTML = '<p class="timeline-empty">No stage data yet.</p>';
          return;
        }

        for (const stage of stages) {
          const card = document.createElement("article");
          card.className = "stage-card";
          const stageName = String(stage.stage || "unknown");
          const desc = stageExplanations[stageName] || "Pipeline stage event.";
          const notes = stage.notes ? String(stage.notes) : "No notes attached.";
          const payloadSize = JSON.stringify(stage).length;
          card.innerHTML = [
            '<div class="stage-top"><h4>' + stageName + '</h4><div class="stage-time">' + String(stage.ts || "-") + "</div></div>",
            '<div class="stage-desc">' + desc + "</div>",
            '<div class="stage-grid">',
            '<div class="stage-cell"><div class="k">Input keys</div><div class="v">' + shortKeys(stage.input) + "</div></div>",
            '<div class="stage-cell"><div class="k">Output keys</div><div class="v">' + shortKeys(stage.output) + "</div></div>",
            '<div class="stage-cell"><div class="k">Notes</div><div class="v">' + notes + "</div></div>",
            '<div class="stage-cell"><div class="k">Payload size</div><div class="v">' + payloadSize + " chars</div></div>",
            "</div>",
            "<details><summary>Raw JSON</summary><pre>" + JSON.stringify(stage, null, 2) + "</pre></details>",
          ].join("");
          storyTimeline.appendChild(card);
        }
      }

      function renderStatus(run, status, inspector) {
        const statusValue = String(status.status || "idle");
        const tone = statusTone(statusValue);
        storyStatusBadge.className = "status-pill " + tone;
        storyStatusBadge.textContent = statusValue.toUpperCase();
        storySummary.innerHTML = [
          "<b>Run ID:</b> " + (run?.run_id || "-"),
          "<br/><b>Job ID:</b> " + (run?.job_id || "-"),
          "<br/><b>Pipeline stage:</b> " + String(status.stage || "-"),
          "<br/><b>Inspector mode:</b> " + (inspector.live ? "live stream" : "persisted trace"),
          "<br/><b>Updated:</b> " + new Date().toLocaleTimeString(),
        ].join("");
      }

      function setMarkdownPreview(mdText) {
        const value = mdText ? String(mdText).slice(0, 3200) : "(run to see output)";
        storyMdPreview.textContent = value;
      }

      function stopPolling() {
        if (state.pollTimer) {
          clearTimeout(state.pollTimer);
          state.pollTimer = null;
        }
      }

      async function pollRun() {
        if (!state.currentRun) return;
        const payload = await fetchJson("/api/runs/" + encodeURIComponent(state.currentRun.run_id));
        const status = payload.status || {};
        const inspector = payload.inspector || {};
        const artifacts = payload.artifacts || {};
        const stages = inspector.stages || [];
        const processing = status.status === "queued" || status.status === "processing";

        renderStatus(state.currentRun, status, inspector);
        renderArtifacts(artifacts.artifacts || []);
        renderFlow(stages, status.status || "idle");
        renderTimeline(stages);
        setMarkdownPreview(payload.markdown_text || "");

        if (processing) {
          state.pollTimer = setTimeout(pollRun, 1000);
          return;
        }
        runBtn.disabled = false;
      }

      function resetRunPanels() {
        storyStatusBadge.className = "status-pill warn";
        storyStatusBadge.textContent = "STARTING";
        storySummary.textContent = "Starting run...";
        renderArtifacts([]);
        renderFlow([], "queued");
        renderTimeline([]);
        setMarkdownPreview("");
      }

      async function startRun() {
        const sampleId = sampleSelect.value;
        if (!sampleId) return;
        runBtn.disabled = true;
        stopPolling();
        resetRunPanels();
        const payload = await fetchJson("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sample_id: sampleId,
            generation_method: methodSelect.value,
          }),
        });
        state.currentRun = payload.run;
        await pollRun();
      }

      sampleSelect.addEventListener("change", async () => {
        const sampleId = sampleSelect.value;
        if (!sampleId) return;
        await loadSampleText(sampleId);
      });
      methodSelect.addEventListener("change", () => {
        writeShareableUrl({ method: methodSelect.value });
      });
      document.getElementById("refreshSamples").addEventListener("click", async () => {
        await loadSamples();
      });
      runBtn.addEventListener("click", async () => {
        try {
          await startRun();
        } catch (error) {
          runBtn.disabled = false;
          storyStatusBadge.className = "status-pill fail";
          storyStatusBadge.textContent = "FAILED";
          storySummary.textContent = "Run failed to start: " + (error && error.message ? error.message : String(error));
        }
      });
      document.addEventListener("keydown", async (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !runBtn.disabled) {
          event.preventDefault();
          runBtn.click();
        }
      });

      methodSelect.value = initialMethod;
      renderFlow([], "idle");
      renderTimeline([]);
      loadSamples().catch((error) => {
        sampleError.textContent = "Failed to load samples: " + (error && error.message ? error.message : String(error));
      });
    </script>
  </body>
</html>`;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    printUsage();
    return;
  }

  const runState = {
    runsById: new Map(),
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${cfg.host}:${cfg.port}`}`);
      if (req.method === "GET" && url.pathname === "/") {
        textResponse(res, 200, buildHtmlPage(), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/samples") {
        const localSamples = await loadLocalSamples(cfg.sampleDir);
        const dataSamples = await loadDataSamples(cfg.dataSampleDir);
        const history = await loadHistorySamples(cfg, 15);
        if (Array.isArray(history)) {
          jsonResponse(res, 200, {
            samples: [...dataSamples, ...localSamples, ...history],
          });
          return;
        }
        jsonResponse(res, 200, {
          samples: [...dataSamples, ...localSamples],
          history_error: history.error,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sample") {
        const sampleId = url.searchParams.get("id");
        if (!sampleId) {
          jsonResponse(res, 400, { error: "Missing sample id" });
          return;
        }
        const sample = await resolveSampleTranscript(cfg, sampleId);
        jsonResponse(res, 200, {
          sample,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runs") {
        const body = await readRequestJson(req);
        const sampleId = typeof body.sample_id === "string" ? body.sample_id : "";
        const generationMethod = "C";
        const sample = await resolveSampleTranscript(cfg, sampleId);
        if (!sample.transcript_text || sample.transcript_text.length < 20) {
          jsonResponse(res, 400, { error: "Sample transcript is too short." });
          return;
        }

        const createPayload = {
          title: sample.title || "Observed Transcript Run",
          language: sample.language || "zh-CN",
          transcript_text: sample.transcript_text,
          template_id: "templateA-v0-book",
          output_formats: ["epub", "md"],
          metadata: {
            episode_url: `local://observe/${Date.now()}`,
            generation_method: generationMethod,
            sample_id: sample.sample_id,
            run_origin: "observe-transcript-run",
          },
          compliance_declaration: {
            for_personal_or_authorized_use_only: true,
            no_commercial_use: true,
          },
        };
        const createResponse = await backendJson(cfg, "/v1/jobs/from-transcript", {
          method: "POST",
          body: createPayload,
        });
        const runId = createRunId();
        const run = {
          run_id: runId,
          job_id: String(createResponse.job_id),
          title: sample.title,
          language: sample.language,
          sample_id: sample.sample_id,
          started_at: new Date().toISOString(),
          markdown_text: "",
          markdown_url: "",
        };
        runState.runsById.set(runId, run);
        jsonResponse(res, 200, { run });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/runs/")) {
        const runId = decodeURIComponent(url.pathname.replace("/api/runs/", ""));
        const run = runState.runsById.get(runId);
        if (!run) {
          jsonResponse(res, 404, { error: "Run not found." });
          return;
        }
        const [status, inspector] = await Promise.all([
          backendJson(cfg, `/v1/jobs/${encodeURIComponent(run.job_id)}`),
          backendJson(cfg, `/v1/jobs/${encodeURIComponent(run.job_id)}/inspector`),
        ]);
        let artifacts = { artifacts: [] };
        let markdownText = run.markdown_text;
        if (status.status === "succeeded") {
          try {
            artifacts = await backendJson(cfg, `/v1/jobs/${encodeURIComponent(run.job_id)}/artifacts`);
            const mdItem = Array.isArray(artifacts.artifacts)
              ? artifacts.artifacts.find((item) => item && item.type === "md")
              : null;
            const mdUrl = typeof mdItem?.download_url === "string" ? mdItem.download_url : "";
            if (mdUrl && mdUrl !== run.markdown_url) {
              const mdResponse = await fetch(mdUrl);
              if (mdResponse.ok) {
                markdownText = await mdResponse.text();
                run.markdown_text = markdownText;
                run.markdown_url = mdUrl;
              }
            }
          } catch {
            // Keep artifacts empty if not ready yet.
          }
        }
        jsonResponse(res, 200, {
          run,
          status,
          inspector,
          artifacts,
          markdown_text: markdownText || "",
        });
        return;
      }

      textResponse(res, 404, "Not Found");
    } catch (error) {
      jsonResponse(res, 500, { error: normalizeError(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, resolve);
  });

  const dashboardUrl = `http://${cfg.host}:${cfg.port}/`;
  // eslint-disable-next-line no-console
  console.log(`Transcript observability dashboard running at ${dashboardUrl}`);
  // eslint-disable-next-line no-console
  console.log(`Backend: ${cfg.baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`Sample dir: ${cfg.sampleDir}`);
  // eslint-disable-next-line no-console
  console.log(`Data sample dir: ${cfg.dataSampleDir}`);
  if (cfg.open) {
    const opened = await openBrowser(dashboardUrl);
    if (!opened) {
      // eslint-disable-next-line no-console
      console.log("Could not auto-open browser. Open the URL manually.");
    }
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(normalizeError(error));
  process.exit(1);
});
