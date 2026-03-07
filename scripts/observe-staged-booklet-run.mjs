#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  host: "127.0.0.1",
  port: 4174,
  baseUrl: "http://localhost:8080",
  token: "dev:cecilia@example.com",
  sampleDir: path.resolve(process.cwd(), "tasks/transcript-samples"),
  dataSampleDir: path.resolve(process.cwd(), "data/transcripts"),
  open: true,
};

const STAGE_STEPS = [
  {
    key: "working_notes",
    title: "Working Notes",
    path: "/v1/working-notes/from-transcript",
    description: "First compression pass from transcript into summary, sections, and excerpts.",
  },
  {
    key: "outline",
    title: "Booklet Outline",
    path: "/v1/booklet-outline/from-working-notes",
    description: "Turn working notes into an ordered section plan.",
  },
  {
    key: "draft",
    title: "Booklet Draft",
    path: "/v1/booklet-draft/from-booklet-outline",
    description: "Write readable section bodies from notes plus outline.",
  },
  {
    key: "epub",
    title: "EPUB Export",
    path: "/v1/epub/from-booklet-draft",
    description: "Deterministic export from the draft into the final EPUB artifact.",
  },
];

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
      out.port = Number(next);
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
  console.log([
    "Usage: node scripts/observe-staged-booklet-run.mjs [options]",
    "",
    "Options:",
    "  --base-url URL      Backend URL (default: http://localhost:8080)",
    "  --token TOKEN       Auth token (default: dev:cecilia@example.com)",
    "  --sample-dir PATH   Local transcript sample directory",
    "  --data-sample-dir PATH  Transcript sample directory from /data",
    "  --host HOST         Dashboard host (default: 127.0.0.1)",
    "  --port PORT         Dashboard port (default: 4174)",
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
  const raw = chunks.length ? Buffer.concat(chunks).toString("utf8") : "{}";
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
      .map((row) => ({
        id: String(row.id ?? ""),
        file: String(row.file ?? ""),
        title: String(row.title ?? ""),
        language: String(row.language ?? "zh-CN"),
        notes: typeof row.notes === "string" ? row.notes : "",
      }))
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
    samples.push({
      id: manifest?.id || `file:${fileName}`,
      source: "local",
      title: manifest?.title || fileName.replace(/\.txt$/i, ""),
      language: manifest?.language || "zh-CN",
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

async function resolveSampleTranscript(cfg, sampleId) {
  const localSamples = await loadLocalSamples(cfg.sampleDir);
  const dataSamples = await loadDataSamples(cfg.dataSampleDir);
  const hit = [...dataSamples, ...localSamples].find((item) => item.id === sampleId);
  if (!hit) {
    throw new Error(`Unknown sample_id: ${sampleId}`);
  }
  const transcriptText = await fs.readFile(hit.file_path, "utf8");
  return {
    sample_id: sampleId,
    title: hit.title,
    language: hit.language,
    transcript_text: transcriptText,
    char_count: transcriptText.length,
  };
}

function attachStepStages(stepKey, response) {
  const stages = Array.isArray(response?.stages) ? response.stages : [];
  return stages.map((stage, index) => ({
    ...stage,
    flow_step: stepKey,
    flow_title: STAGE_STEPS.find((item) => item.key === stepKey)?.title ?? stepKey,
    flow_index: index,
  }));
}

async function runStagedFlow(cfg, sample) {
  const transcriptMeta = {
    title: sample.title,
    language: sample.language,
    metadata: {
      episode_url: `local://observe-staged/${Date.now()}`,
      sample_id: sample.sample_id,
      run_origin: "observe-staged-booklet-run",
    },
  };

  const workingNotes = await backendJson(cfg, "/v1/working-notes/from-transcript", {
    method: "POST",
    body: {
      ...transcriptMeta,
      transcript_text: sample.transcript_text,
    },
  });

  const outline = await backendJson(cfg, "/v1/booklet-outline/from-working-notes", {
    method: "POST",
    body: {
      ...transcriptMeta,
      working_notes: workingNotes.working_notes,
    },
  });

  const draft = await backendJson(cfg, "/v1/booklet-draft/from-booklet-outline", {
    method: "POST",
    body: {
      ...transcriptMeta,
      working_notes: workingNotes.working_notes,
      booklet_outline: outline.booklet_outline,
    },
  });

  const epub = await backendJson(cfg, "/v1/epub/from-booklet-draft", {
    method: "POST",
    body: {
      ...transcriptMeta,
      booklet_draft: draft.booklet_draft,
    },
  });

  return {
    working_notes: workingNotes,
    outline,
    draft,
    epub,
    stages: [
      ...attachStepStages("working_notes", workingNotes),
      ...attachStepStages("outline", outline),
      ...attachStepStages("draft", draft),
      ...attachStepStages("epub", epub),
    ],
  };
}

function buildHtmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Staged Booklet Run Lab</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");

      :root {
        --bg: #f6f0e8;
        --ink: #18212f;
        --muted: #615b57;
        --panel: rgba(255, 252, 247, 0.92);
        --stroke: #d8cabd;
        --accent: #a94e32;
        --accent-soft: #f8e3d8;
        --teal: #165d60;
        --teal-soft: #dff2f2;
        --lilac: #e7e3fb;
        --lilac-deep: #554a88;
        --ok: #1d8b57;
        --warn: #9b6107;
        --fail: #b12839;
        --shadow: 0 28px 64px rgba(71, 43, 19, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Manrope", ui-sans-serif, sans-serif;
        background:
          radial-gradient(900px 560px at 0% 0%, rgba(233, 145, 84, 0.18), transparent 70%),
          radial-gradient(1000px 560px at 100% 0%, rgba(80, 157, 165, 0.18), transparent 72%),
          linear-gradient(180deg, #f9f4ed 0%, #f4ece4 100%);
      }
      .shell {
        width: min(1380px, 94vw);
        margin: 0 auto;
        padding: 18px 0 36px;
        display: grid;
        gap: 14px;
      }
      .panel {
        border: 1px solid var(--stroke);
        border-radius: 22px;
        padding: 18px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }
      .hero {
        position: relative;
        overflow: hidden;
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -80px -120px auto;
        width: 320px;
        height: 320px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(169, 78, 50, 0.24), transparent 70%);
        pointer-events: none;
      }
      h1, h2, h3, h4 { margin: 0; line-height: 1.1; }
      h1 {
        font-family: "Fraunces", serif;
        font-size: clamp(34px, 5vw, 58px);
        letter-spacing: 0.03em;
      }
      .hero-sub {
        margin-top: 10px;
        max-width: 820px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.6;
      }
      .pills {
        margin-top: 14px;
        display: grid;
        grid-template-columns: repeat(3, minmax(180px, 1fr));
        gap: 10px;
      }
      .pill {
        border: 1px solid var(--stroke);
        border-radius: 14px;
        padding: 12px;
        background: #fff8f1;
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
        font-size: 12px;
      }
      .toolbar {
        display: grid;
        grid-template-columns: 1.3fr auto auto;
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
      select, button, textarea {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--stroke);
        background: #fffdfa;
        font: inherit;
      }
      select, button {
        padding: 11px 12px;
        font-size: 14px;
      }
      button {
        cursor: pointer;
        font-weight: 800;
      }
      .btn-run {
        background: linear-gradient(135deg, var(--accent), #c96842);
        border-color: transparent;
        color: white;
      }
      .btn-muted {
        background: #fff6ed;
      }
      button:disabled { opacity: 0.6; cursor: wait; }
      .meta-line {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
      }
      .error {
        margin-top: 8px;
        color: var(--fail);
        font-size: 13px;
        white-space: pre-wrap;
      }
      .split {
        display: grid;
        grid-template-columns: 1fr 1.2fr;
        gap: 14px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 10px;
      }
      .section-head h2 {
        font-family: "Fraunces", serif;
        font-size: 26px;
      }
      .section-head p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
      }
      .transcript-meta {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 8px;
      }
      textarea {
        min-height: 420px;
        resize: vertical;
        padding: 12px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 12px;
        line-height: 1.55;
      }
      .run-status {
        border: 1px solid var(--stroke);
        border-radius: 16px;
        padding: 14px;
        background: linear-gradient(160deg, #fff7ef 0%, #fffdfa 100%);
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        border: 1px solid var(--stroke);
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .status-pill::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--warn);
      }
      .status-pill.ok::before { background: var(--ok); }
      .status-pill.fail::before { background: var(--fail); }
      .status-summary {
        margin-top: 10px;
        font-size: 13px;
        line-height: 1.7;
      }
      .artifact-links {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .artifact-links a {
        text-decoration: none;
        color: white;
        background: var(--teal);
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 12px;
        font-weight: 800;
      }
      .step-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(160px, 1fr));
        gap: 10px;
      }
      .step-card {
        border: 1px solid var(--stroke);
        border-radius: 16px;
        padding: 12px;
        background: #fffdfa;
        min-height: 118px;
      }
      .step-card.done {
        background: #eff8f2;
        border-color: rgba(29, 139, 87, 0.35);
      }
      .step-card .state {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
      }
      .step-card .name {
        margin-top: 8px;
        font-size: 14px;
        font-weight: 800;
      }
      .step-card .desc {
        margin-top: 6px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .artifact-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .artifact-card {
        border: 1px solid var(--stroke);
        border-radius: 18px;
        padding: 14px;
        background: #fffdfa;
      }
      .artifact-card.notes { background: linear-gradient(180deg, #fff8f1 0%, #fffdfa 100%); }
      .artifact-card.outline { background: linear-gradient(180deg, #f5fbfb 0%, #fffdfa 100%); }
      .artifact-card.draft { background: linear-gradient(180deg, #f7f5ff 0%, #fffdfa 100%); }
      .artifact-card h3 {
        font-family: "Fraunces", serif;
        font-size: 24px;
      }
      .artifact-hint {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
      }
      .artifact-body {
        margin-top: 12px;
        display: grid;
        gap: 10px;
        min-height: 220px;
      }
      .mini-list {
        margin: 0;
        padding-left: 20px;
        display: grid;
        gap: 6px;
      }
      .draft-section {
        border-top: 1px solid var(--stroke);
        padding-top: 10px;
        display: grid;
        gap: 8px;
      }
      .draft-section:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .draft-section p {
        margin: 0;
        color: #2f3544;
        line-height: 1.65;
        font-size: 13px;
      }
      .section-chip {
        display: inline-block;
        margin-right: 6px;
        margin-bottom: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #78351f;
        font-size: 12px;
        font-weight: 700;
      }
      .goal-line {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }
      .timeline {
        display: grid;
        gap: 10px;
      }
      .timeline-empty {
        color: var(--muted);
        font-size: 13px;
      }
      .timeline-card {
        border: 1px solid var(--stroke);
        border-radius: 16px;
        background: #fffdfa;
        padding: 12px;
      }
      .timeline-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: baseline;
      }
      .timeline-top h4 {
        font-size: 16px;
      }
      .timeline-time {
        color: var(--muted);
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 11px;
      }
      .timeline-desc {
        margin-top: 4px;
        color: var(--muted);
        font-size: 13px;
      }
      .timeline-grid {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .timeline-cell {
        border: 1px solid var(--stroke);
        border-radius: 12px;
        background: #fffcf8;
        padding: 8px;
      }
      .timeline-cell .k {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .timeline-cell .v {
        margin-top: 6px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 11px;
        line-height: 1.4;
        word-break: break-word;
      }
      details {
        margin-top: 10px;
        border: 1px dashed var(--stroke);
        border-radius: 12px;
        padding: 8px;
        background: #fffcf8;
      }
      summary {
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }
      pre {
        margin: 8px 0 0;
        border: 1px solid var(--stroke);
        border-radius: 12px;
        padding: 10px;
        background: #fffcf9;
        overflow: auto;
        max-height: 240px;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 11px;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      @media (max-width: 1180px) {
        .pills, .artifact-grid, .step-grid, .timeline-grid { grid-template-columns: 1fr; }
        .toolbar, .split { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel hero">
        <h1>Staged Booklet Run Lab</h1>
        <p class="hero-sub">Run the real transcript flow and inspect the actual generated artifacts without guessing. This is for judging input-to-output quality, not just checking whether the API returns 200.</p>
        <div class="pills">
          <div class="pill"><div class="k">Use</div><div class="v">Quality review on real transcripts</div></div>
          <div class="pill"><div class="k">Flow</div><div class="v">Transcript -> Notes -> Outline -> Draft -> EPUB</div></div>
          <div class="pill"><div class="k">Audience</div><div class="v">Ceci + collaborators reviewing actual output</div></div>
        </div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <label for="sampleSelect">Transcript Sample</label>
            <select id="sampleSelect"></select>
          </div>
          <button id="refreshSamples" class="btn-muted">Refresh Samples</button>
          <button id="runBtn" class="btn-run">Run Staged Flow</button>
        </div>
        <p id="sampleMeta" class="meta-line">Loading samples...</p>
        <p id="sampleError" class="error"></p>
      </section>

      <section class="split">
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
            <h2>Run Summary</h2>
            <p>What came out</p>
          </div>
          <div class="run-status">
            <div id="statusBadge" class="status-pill">IDLE</div>
            <div id="statusSummary" class="status-summary">Pick a transcript and run the staged flow.</div>
            <div id="artifactLinks" class="artifact-links"></div>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Flow Steps</h2>
          <p>Which artifact exists so far</p>
        </div>
        <div id="stepGrid" class="step-grid"></div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Artifact Review</h2>
          <p>Look at the generated content, not just raw JSON</p>
        </div>
        <div class="artifact-grid">
          <article class="artifact-card notes">
            <h3>Working Notes</h3>
            <p class="artifact-hint">Summary bullets plus candidate sections and excerpts.</p>
            <div id="notesCard" class="artifact-body"></div>
          </article>
          <article class="artifact-card outline">
            <h3>Outline</h3>
            <p class="artifact-hint">Section order and each section’s goal.</p>
            <div id="outlineCard" class="artifact-body"></div>
          </article>
          <article class="artifact-card draft">
            <h3>Draft</h3>
            <p class="artifact-hint">Readable section bodies before EPUB export.</p>
            <div id="draftCard" class="artifact-body"></div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Stage Timeline</h2>
          <p>Low-level trace from each API step</p>
        </div>
        <div id="timeline" class="timeline"></div>
      </section>
    </main>

    <script>
      const stageSteps = ${JSON.stringify(STAGE_STEPS)};
      const state = {
        samples: [],
        currentRun: null,
      };

      const sampleSelect = document.getElementById("sampleSelect");
      const sampleMeta = document.getElementById("sampleMeta");
      const sampleError = document.getElementById("sampleError");
      const inputMeta = document.getElementById("inputMeta");
      const transcriptPreview = document.getElementById("transcriptPreview");
      const statusBadge = document.getElementById("statusBadge");
      const statusSummary = document.getElementById("statusSummary");
      const artifactLinks = document.getElementById("artifactLinks");
      const stepGrid = document.getElementById("stepGrid");
      const notesCard = document.getElementById("notesCard");
      const outlineCard = document.getElementById("outlineCard");
      const draftCard = document.getElementById("draftCard");
      const timeline = document.getElementById("timeline");
      const runBtn = document.getElementById("runBtn");

      function prettyJson(value) {
        return JSON.stringify(value, null, 2);
      }

      async function fetchJson(pathName, options = {}) {
        const response = await fetch(pathName, options);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload && payload.error ? payload.error : JSON.stringify(payload));
        }
        return payload;
      }

      function summarizeSample(sample) {
        return (sample.source || "local") + " · " + sample.char_count + " chars";
      }

      function shortKeys(record) {
        if (!record || typeof record !== "object") return "-";
        const keys = Object.keys(record).slice(0, 8);
        return keys.length ? keys.join(", ") : "-";
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

      async function loadSamples() {
        sampleError.textContent = "";
        sampleMeta.textContent = "Loading samples...";
        const payload = await fetchJson("/api/samples");
        state.samples = payload.samples || [];
        renderSampleOptions();
        sampleMeta.textContent = "Loaded " + state.samples.length + " samples.";
        if (state.samples.length > 0) {
          sampleSelect.value = state.samples[0].id;
          await loadSampleText(state.samples[0].id);
        }
      }

      async function loadSampleText(sampleId) {
        const payload = await fetchJson("/api/sample?id=" + encodeURIComponent(sampleId));
        const sample = payload.sample || {};
        transcriptPreview.value = sample.transcript_text || "";
        inputMeta.textContent = (sample.title || sampleId) + " · " + (sample.language || "zh-CN") + " · " + (sample.char_count || 0) + " chars";
      }

      function resetArtifactCards() {
        notesCard.innerHTML = "<p class='artifact-hint'>Run to populate working notes.</p>";
        outlineCard.innerHTML = "<p class='artifact-hint'>Run to populate outline.</p>";
        draftCard.innerHTML = "<p class='artifact-hint'>Run to populate draft.</p>";
      }

      function renderStepGrid(run) {
        stepGrid.innerHTML = "";
        const available = new Set();
        if (run?.working_notes?.working_notes) available.add("working_notes");
        if (run?.outline?.booklet_outline) available.add("outline");
        if (run?.draft?.booklet_draft) available.add("draft");
        if (run?.epub?.artifacts?.length) available.add("epub");
        for (const step of stageSteps) {
          const card = document.createElement("article");
          card.className = "step-card" + (available.has(step.key) ? " done" : "");
          card.innerHTML = [
            '<div class="state">' + (available.has(step.key) ? "ready" : "pending") + "</div>",
            '<div class="name">' + step.title + "</div>",
            '<div class="desc">' + step.description + "</div>",
          ].join("");
          stepGrid.appendChild(card);
        }
      }

      function renderNotes(run) {
        const notes = run?.working_notes?.working_notes;
        if (!notes) {
          notesCard.innerHTML = "<p class='artifact-hint'>No working notes yet.</p>";
          return;
        }
        const summary = (notes.summary || []).map((item) => "<li>" + item + "</li>").join("");
        const sections = (notes.sections || [])
          .map((section) =>
            '<div><strong>' + section.heading + '</strong><div class="goal-line">' +
              (section.excerpts || []).slice(0, 2).join(" / ") +
            "</div></div>"
          )
          .join("");
        notesCard.innerHTML = [
          "<div><strong>Summary</strong><ul class='mini-list'>" + summary + "</ul></div>",
          "<div><strong>Sections</strong><div>" + sections + "</div></div>",
          "<details><summary>Raw JSON</summary><pre>" + prettyJson(notes) + "</pre></details>",
        ].join("");
      }

      function renderOutline(run) {
        const outline = run?.outline?.booklet_outline;
        if (!outline) {
          outlineCard.innerHTML = "<p class='artifact-hint'>No outline yet.</p>";
          return;
        }
        outlineCard.innerHTML = [
          "<div><strong>Title</strong><div class='goal-line'>" + (outline.title || "-") + "</div></div>",
          "<div>" +
            (outline.sections || [])
              .map((section) =>
                "<div class='draft-section'><strong>" + section.heading + "</strong><div class='goal-line'>" + (section.goal || "No goal") + "</div></div>"
              )
              .join("") +
          "</div>",
          "<details><summary>Raw JSON</summary><pre>" + prettyJson(outline) + "</pre></details>",
        ].join("");
      }

      function renderDraft(run) {
        const draft = run?.draft?.booklet_draft;
        if (!draft) {
          draftCard.innerHTML = "<p class='artifact-hint'>No draft yet.</p>";
          return;
        }
        draftCard.innerHTML = [
          "<div><strong>Title</strong><div class='goal-line'>" + (draft.title || "-") + "</div></div>",
          "<div>" +
            (draft.sections || [])
              .map((section) =>
                "<div class='draft-section'><strong>" + section.heading + "</strong><p>" + String(section.body || "").slice(0, 360) + "</p></div>"
              )
              .join("") +
          "</div>",
          "<details><summary>Raw JSON</summary><pre>" + prettyJson(draft) + "</pre></details>",
        ].join("");
      }

      function renderTimeline(run) {
        timeline.innerHTML = "";
        const stages = run?.stages || [];
        if (!stages.length) {
          timeline.innerHTML = "<p class='timeline-empty'>No stage data yet.</p>";
          return;
        }
        for (const stage of stages) {
          const card = document.createElement("article");
          card.className = "timeline-card";
          card.innerHTML = [
            '<div class="timeline-top"><h4>' + stage.flow_title + " · " + stage.stage + '</h4><div class="timeline-time">' + (stage.ts || "-") + "</div></div>",
            '<div class="timeline-desc">' + (stageSteps.find((item) => item.key === stage.flow_step)?.description || "Pipeline stage") + "</div>",
            '<div class="timeline-grid">',
            '<div class="timeline-cell"><div class="k">Input keys</div><div class="v">' + shortKeys(stage.input) + "</div></div>",
            '<div class="timeline-cell"><div class="k">Output keys</div><div class="v">' + shortKeys(stage.output) + "</div></div>",
            '<div class="timeline-cell"><div class="k">Notes</div><div class="v">' + (stage.notes || "-") + "</div></div>",
            "</div>",
            "<details><summary>Raw JSON</summary><pre>" + prettyJson(stage) + "</pre></details>",
          ].join("");
          timeline.appendChild(card);
        }
      }

      function renderSummary(run) {
        const epub = run?.epub;
        statusBadge.className = "status-pill ok";
        statusBadge.textContent = "SUCCEEDED";
        statusSummary.innerHTML = [
          "<b>Run ID:</b> " + (run?.run_id || "-"),
          "<br/><b>Sample:</b> " + (run?.sample?.title || "-"),
          "<br/><b>Notes sections:</b> " + (run?.working_notes?.working_notes?.sections?.length || 0),
          "<br/><b>Outline sections:</b> " + (run?.outline?.booklet_outline?.sections?.length || 0),
          "<br/><b>Draft sections:</b> " + (run?.draft?.booklet_draft?.sections?.length || 0),
          "<br/><b>EPUB artifacts:</b> " + (epub?.artifacts?.length || 0),
        ].join("");
        artifactLinks.innerHTML = (epub?.artifacts || [])
          .map((item) => '<a href="' + item.download_url + '" target="_blank" rel="noreferrer">Download ' + String(item.type || "").toUpperCase() + "</a>")
          .join("");
      }

      function renderRun(run) {
        renderSummary(run);
        renderStepGrid(run);
        renderNotes(run);
        renderOutline(run);
        renderDraft(run);
        renderTimeline(run);
      }

      function resetRun() {
        statusBadge.className = "status-pill";
        statusBadge.textContent = "RUNNING";
        statusSummary.textContent = "Running staged flow...";
        artifactLinks.innerHTML = "";
        renderStepGrid(null);
        resetArtifactCards();
        renderTimeline(null);
      }

      async function startRun() {
        const sampleId = sampleSelect.value;
        if (!sampleId) return;
        runBtn.disabled = true;
        resetRun();
        try {
          const payload = await fetchJson("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sample_id: sampleId }),
          });
          state.currentRun = payload.run;
          renderRun(payload.run);
        } catch (error) {
          statusBadge.className = "status-pill fail";
          statusBadge.textContent = "FAILED";
          statusSummary.textContent = "Run failed: " + (error && error.message ? error.message : String(error));
        } finally {
          runBtn.disabled = false;
        }
      }

      sampleSelect.addEventListener("change", async () => {
        await loadSampleText(sampleSelect.value);
      });
      document.getElementById("refreshSamples").addEventListener("click", async () => {
        await loadSamples();
      });
      runBtn.addEventListener("click", async () => {
        await startRun();
      });

      renderStepGrid(null);
      resetArtifactCards();
      renderTimeline(null);
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
        jsonResponse(res, 200, { samples: [...dataSamples, ...localSamples] });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sample") {
        const sampleId = url.searchParams.get("id");
        if (!sampleId) {
          jsonResponse(res, 400, { error: "Missing sample id" });
          return;
        }
        const sample = await resolveSampleTranscript(cfg, sampleId);
        jsonResponse(res, 200, { sample });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runs") {
        const body = await readRequestJson(req);
        const sampleId = typeof body.sample_id === "string" ? body.sample_id : "";
        const sample = await resolveSampleTranscript(cfg, sampleId);
        const runId = createRunId();
        const result = await runStagedFlow(cfg, sample);
        const run = {
          run_id: runId,
          sample,
          ...result,
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
        jsonResponse(res, 200, { run });
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
  console.log(`Staged booklet dashboard running at ${dashboardUrl}`);
  console.log(`Backend: ${cfg.baseUrl}`);
  console.log(`Sample dir: ${cfg.sampleDir}`);
  console.log(`Data sample dir: ${cfg.dataSampleDir}`);
  if (cfg.open) {
    const opened = await openBrowser(dashboardUrl);
    if (!opened) {
      console.log("Could not auto-open browser. Open the URL manually.");
    }
  }
}

main().catch((error) => {
  console.error(normalizeError(error));
  process.exit(1);
});
