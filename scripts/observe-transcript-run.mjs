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
      notes: manifest?.notes || "",
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
  const hit = localSamples.find((item) => item.id === sampleId);
  if (!hit) {
    throw new Error(`Unknown sample_id: ${sampleId}`);
  }
  const transcriptPath = path.join(cfg.sampleDir, hit.file_name);
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
    <title>Transcript to EPUB Live Lab</title>
    <style>
      :root {
        --bg: #f6f8fc;
        --panel: #ffffff;
        --text: #1c2940;
        --muted: #5a6986;
        --border: #dce4f2;
        --accent: #0b63db;
        --ok: #128a3f;
        --warn: #9b6b05;
      }
      body { margin: 0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
      .wrap { max-width: 1280px; margin: 0 auto; padding: 16px; display: grid; gap: 12px; }
      .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
      h1, h2, h3 { margin: 0 0 8px; }
      .grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
      .top { display: grid; gap: 12px; grid-template-columns: 1fr; }
      @media (min-width: 1024px) { .top { grid-template-columns: 1fr 1fr; } }
      label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 6px; }
      select, button, input { font-size: 14px; padding: 8px; border-radius: 8px; border: 1px solid var(--border); }
      button { background: var(--accent); color: #fff; border: 0; cursor: pointer; }
      button:disabled { opacity: .5; cursor: wait; }
      textarea { width: 100%; min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
      .meta { color: var(--muted); font-size: 12px; }
      .status-ok { color: var(--ok); font-weight: 600; }
      .status-warn { color: var(--warn); font-weight: 600; }
      .timeline { display: grid; gap: 10px; }
      .stage { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fcfdff; }
      .stage h3 { font-size: 14px; margin-bottom: 4px; }
      .stage .desc { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
      .stage .stamp { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
      .kv { font-size: 12px; color: var(--text); display: grid; gap: 4px; }
      .kv div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      details { margin-top: 8px; }
      pre { margin: 0; font-size: 11px; background: #f4f7ff; border: 1px solid var(--border); border-radius: 8px; padding: 8px; overflow: auto; max-height: 260px; }
      a { color: var(--accent); }
      .error { color: #b91c1c; font-size: 12px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="panel">
        <h1>Transcript to EPUB Live Lab</h1>
        <p class="meta">Result-first E2E run view + stage-by-stage observability for learning and debugging.</p>
      </section>

      <section class="panel">
        <div class="row">
          <div style="min-width:260px; flex: 1;">
            <label for="sampleSelect">Transcript Sample</label>
            <select id="sampleSelect"></select>
          </div>
          <div style="min-width:160px;">
            <label for="methodSelect">Generation Method</label>
            <select id="methodSelect">
              <option value="B">Method B</option>
              <option value="A">Method A</option>
              <option value="C">Method C</option>
            </select>
          </div>
          <div>
            <button id="refreshSamples">Refresh Samples</button>
          </div>
          <div>
            <button id="runBtn">Run E2E</button>
          </div>
        </div>
        <p class="meta" id="sampleMeta">Loading samples...</p>
        <p class="error" id="sampleError"></p>
      </section>

      <section class="top">
        <article class="panel">
          <h2>Input Transcript</h2>
          <p class="meta" id="inputMeta"></p>
          <textarea id="transcriptPreview" readonly></textarea>
        </article>
        <article class="panel">
          <h2>Final EPUB Result</h2>
          <div id="resultSummary" class="meta">No run yet.</div>
          <div id="resultLinks" class="meta"></div>
          <h3 style="margin-top: 10px;">Markdown Preview</h3>
          <pre id="mdPreview">(run to see output)</pre>
        </article>
      </section>

      <section class="panel">
        <h2>Live Stage Timeline</h2>
        <p class="meta">Each card explains what happened in that stage. Expand raw JSON for full payloads.</p>
        <div class="timeline" id="timeline"></div>
      </section>
    </main>

    <script>
      const stageExplanations = ${JSON.stringify(STAGE_EXPLANATIONS)};
      const state = {
        samples: [],
        currentRun: null,
        pollTimer: null,
      };

      const sampleSelect = document.getElementById("sampleSelect");
      const methodSelect = document.getElementById("methodSelect");
      const sampleMeta = document.getElementById("sampleMeta");
      const sampleError = document.getElementById("sampleError");
      const inputMeta = document.getElementById("inputMeta");
      const transcriptPreview = document.getElementById("transcriptPreview");
      const resultSummary = document.getElementById("resultSummary");
      const resultLinks = document.getElementById("resultLinks");
      const mdPreview = document.getElementById("mdPreview");
      const timeline = document.getElementById("timeline");
      const runBtn = document.getElementById("runBtn");

      async function fetchJson(path, options = {}) {
        const response = await fetch(path, options);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload && payload.error ? payload.error : JSON.stringify(payload));
        }
        return payload;
      }

      function summarizeSample(sample) {
        const source = sample.source === "history" ? "history" : "local";
        return source + " · " + sample.char_count + " chars" + (sample.created_at ? " · " + sample.created_at : "");
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
        transcriptPreview.value = sample.transcript_text || "";
        inputMeta.textContent = (sample.title || sampleId) + " · " + (sample.language || "zh-CN") + " · " + (sample.char_count || 0) + " chars";
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
          await loadSampleText(state.samples[0].id);
        } else {
          transcriptPreview.value = "";
          inputMeta.textContent = "No sample found. Add .txt files under tasks/transcript-samples.";
        }
      }

      function renderLinks(artifacts) {
        if (!Array.isArray(artifacts) || artifacts.length === 0) {
          resultLinks.innerHTML = "";
          return;
        }
        resultLinks.innerHTML = artifacts.map((item) => {
          return '<div><a href="' + item.download_url + '" target="_blank" rel="noreferrer">Download ' + item.type + "</a></div>";
        }).join("");
      }

      function renderTimeline(stages) {
        timeline.innerHTML = "";
        if (!Array.isArray(stages) || stages.length === 0) {
          timeline.innerHTML = "<p class=\\"meta\\">No stage data yet.</p>";
          return;
        }
        for (const stage of stages) {
          const card = document.createElement("article");
          card.className = "stage";
          const name = stage.stage || "unknown";
          const desc = stageExplanations[name] || "Stage emitted from pipeline.";
          const notes = stage.notes ? "<div><strong>Notes:</strong> " + stage.notes + "</div>" : "";
          const inputKeys = stage.input ? Object.keys(stage.input).slice(0, 4).join(", ") : "-";
          const outputKeys = stage.output ? Object.keys(stage.output).slice(0, 4).join(", ") : "-";
          card.innerHTML = [
            "<h3>" + name + "</h3>",
            "<div class=\\"desc\\">" + desc + "</div>",
            "<div class=\\"stamp\\">" + (stage.ts || "") + "</div>",
            "<div class=\\"kv\\">",
            "<div><strong>Input keys:</strong> " + inputKeys + "</div>",
            "<div><strong>Output keys:</strong> " + outputKeys + "</div>",
            notes,
            "</div>",
            "<details><summary>Raw JSON</summary><pre>" + JSON.stringify(stage, null, 2) + "</pre></details>",
          ].join("");
          timeline.appendChild(card);
        }
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
        const mdText = payload.markdown_text || "";
        const processing = status.status === "queued" || status.status === "processing";
        const statusClass = status.status === "succeeded" ? "status-ok" : processing ? "status-warn" : "status-warn";
        resultSummary.innerHTML = [
          "Run ID: " + state.currentRun.run_id,
          "<br/>Job ID: " + state.currentRun.job_id,
          "<br/>Status: <span class=\\"" + statusClass + "\\">" + (status.status || "unknown") + "</span>",
          "<br/>Pipeline stage: " + (status.stage || "-"),
          inspector.live ? "<br/>Inspector mode: live" : "<br/>Inspector mode: persisted",
        ].join("");
        renderLinks(artifacts.artifacts || []);
        if (mdText) {
          mdPreview.textContent = mdText.slice(0, 3200);
        }
        renderTimeline(inspector.stages || []);
        if (processing) {
          state.pollTimer = setTimeout(pollRun, 1000);
          return;
        }
        runBtn.disabled = false;
      }

      async function startRun() {
        const sampleId = sampleSelect.value;
        if (!sampleId) return;
        runBtn.disabled = true;
        stopPolling();
        resultSummary.textContent = "Starting run...";
        resultLinks.innerHTML = "";
        mdPreview.textContent = "(running...)";
        timeline.innerHTML = "<p class=\\"meta\\">Waiting for stage data...</p>";
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

      document.getElementById("refreshSamples").addEventListener("click", async () => {
        await loadSamples();
      });

      runBtn.addEventListener("click", async () => {
        try {
          await startRun();
        } catch (error) {
          runBtn.disabled = false;
          resultSummary.innerHTML = "<span class=\\"status-warn\\">Run failed to start: " + (error && error.message ? error.message : String(error)) + "</span>";
        }
      });

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
        const history = await loadHistorySamples(cfg, 15);
        if (Array.isArray(history)) {
          jsonResponse(res, 200, {
            samples: [...localSamples, ...history],
          });
          return;
        }
        jsonResponse(res, 200, {
          samples: localSamples,
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
        const generationMethod = body.generation_method === "A" || body.generation_method === "C" ? body.generation_method : "B";
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
