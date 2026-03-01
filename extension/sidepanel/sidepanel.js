const STORAGE_KEY = "pte_settings_v1";
const LAST_JOB_KEY = "pte_last_job_v1";
const MAX_PAYLOAD_LOGS = 80;
const MAX_PAYLOAD_PREVIEW_CHARS = 6000;
const DEFAULTS = {
  apiBaseUrl: "http://localhost:8080",
  token: "dev:cecilia@example.com",
};

const elements = {
  apiBaseUrl: document.getElementById("api-base-url"),
  apiToken: document.getElementById("api-token"),
  saveSettings: document.getElementById("save-settings"),
  loadSample: document.getElementById("load-sample"),
  settingsFeedback: document.getElementById("settings-feedback"),
  form: document.getElementById("transcript-form"),
  title: document.getElementById("title"),
  language: document.getElementById("language"),
  templateId: document.getElementById("template-id"),
  episodeUrl: document.getElementById("episode-url"),
  transcriptText: document.getElementById("transcript-text"),
  checkPersonal: document.getElementById("check-personal"),
  checkNonCommercial: document.getElementById("check-noncommercial"),
  submitJob: document.getElementById("submit-job"),
  jobId: document.getElementById("job-id"),
  jobStatus: document.getElementById("job-status"),
  jobStage: document.getElementById("job-stage"),
  jobProgress: document.getElementById("job-progress"),
  meterFill: document.getElementById("meter-fill"),
  errorBox: document.getElementById("error-box"),
  artifactsList: document.getElementById("artifacts-list"),
  eventsList: document.getElementById("events-list"),
  topTabWorkspace: document.getElementById("top-tab-workspace"),
  topTabPayload: document.getElementById("top-tab-payload"),
  workspaceRoot: document.getElementById("workspace-root"),
  payloadRoot: document.getElementById("payload-root"),
  clearPayloadLogs: document.getElementById("clear-payload-logs"),
  payloadList: document.getElementById("payload-list"),
};

let pollTimer = null;
let didAutoSwitchBaseUrl = false;
let activeTab = "workspace";
const payloadLogs = [];

function autoGenerateTitle(transcript) {
  const body = String(transcript || "").replace(/^.*?transcript\s*:/is, "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const rawLine of lines) {
    if (/^(keywords|transcript)\s*:?$/i.test(rawLine)) {
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(rawLine) && /cst|h\s*\d+\s*min/i.test(rawLine)) {
      continue;
    }
    const keywordParts = rawLine.split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
    if (keywordParts.length >= 8 && !/[。.!?！？]/.test(rawLine)) {
      continue;
    }
    const cleaned = rawLine
      .replace(/^(speaker\s*\d+|host|guest|主持人|嘉宾)\s*[0-9:：\s-]*[:：-]?\s*/i, "")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
      .replace(/^[\s:：\-，,。.!！?？]+/, "")
      .trim();
    if (cleaned.length >= 6) {
      return cleaned.slice(0, 60);
    }
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  return `Podcast Notes ${dateStr}`;
}

function showSettingsFeedback(message, isError = false) {
  elements.settingsFeedback.textContent = message;
  elements.settingsFeedback.style.color = isError ? "#b42318" : "#5f6f8a";
}

function renderError(message) {
  elements.errorBox.hidden = false;
  elements.errorBox.textContent = message;
}

function clearError() {
  elements.errorBox.hidden = true;
  elements.errorBox.textContent = "";
}

function setActiveTab(tabName) {
  activeTab = tabName;
  const showPayload = tabName === "payload";
  elements.topTabWorkspace.classList.toggle("active", !showPayload);
  elements.topTabPayload.classList.toggle("active", showPayload);
  elements.topTabWorkspace.setAttribute("aria-selected", String(!showPayload));
  elements.topTabPayload.setAttribute("aria-selected", String(showPayload));
  elements.workspaceRoot.hidden = showPayload;
  elements.payloadRoot.hidden = !showPayload;
}

function toPayloadPreview(value) {
  if (value === undefined) {
    return "(none)";
  }
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch (_error) {
    text = String(value);
  }
  if (text.length <= MAX_PAYLOAD_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PAYLOAD_PREVIEW_CHARS)}\n... <truncated>`;
}

function pushPayloadLog(entry) {
  payloadLogs.push(entry);
  if (payloadLogs.length > MAX_PAYLOAD_LOGS) {
    payloadLogs.splice(0, payloadLogs.length - MAX_PAYLOAD_LOGS);
  }
  renderPayloadLogs();
}

function renderPayloadLogs() {
  elements.payloadList.innerHTML = "";
  if (!payloadLogs.length) {
    elements.payloadList.innerHTML = "<li>No payload logs yet.</li>";
    return;
  }
  for (const entry of payloadLogs.slice().reverse()) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "payload-meta";
    meta.textContent =
      `${new Date(entry.ts).toLocaleTimeString()} · ${entry.method} ${entry.path}` +
      (entry.status ? ` · HTTP ${entry.status}` : "") +
      (entry.kind === "network_error" ? " · Network Error" : "");

    const reqLabel = document.createElement("p");
    reqLabel.className = "payload-label";
    reqLabel.textContent = `Request -> ${entry.url}`;

    const reqBlock = document.createElement("pre");
    reqBlock.className = "payload-block";
    reqBlock.textContent = entry.requestBody;

    const resLabel = document.createElement("p");
    resLabel.className = "payload-label";
    resLabel.textContent = "Response";

    const resBlock = document.createElement("pre");
    resBlock.className = "payload-block";
    resBlock.textContent = entry.responseBody;

    li.appendChild(meta);
    li.appendChild(reqLabel);
    li.appendChild(reqBlock);
    li.appendChild(resLabel);
    li.appendChild(resBlock);
    elements.payloadList.appendChild(li);
  }
}

function renderStatus(data) {
  elements.jobId.textContent = data.job_id || "-";
  elements.jobStatus.textContent = data.status || "idle";
  elements.jobStage.textContent = data.stage || "-";
  const progress = Number(data.progress || 0);
  elements.jobProgress.textContent = `${progress}%`;
  elements.meterFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function renderArtifacts(data) {
  elements.artifactsList.innerHTML = "";
  if (!data?.artifacts?.length) {
    elements.artifactsList.innerHTML = "<li>No artifacts yet.</li>";
    return;
  }
  for (const item of data.artifacts) {
    const li = document.createElement("li");
    li.className = "artifact-item";
    li.innerHTML = `<a class="artifact-card-link" href="${item.download_url}" target="_blank" rel="noreferrer">
      <div class="artifact-type">${item.type.toUpperCase()}</div>
      <div>${item.file_name}</div>
      <div>${item.size_bytes} bytes · expires ${new Date(item.expires_at).toLocaleString()}</div>
    </a>`;
    elements.artifactsList.appendChild(li);
  }
}

function renderInspector(data) {
  elements.eventsList.innerHTML = "";
  if (!data?.stages?.length) {
    elements.eventsList.innerHTML = "<li>No inspector stages yet.</li>";
    return;
  }
  for (const stage of data.stages) {
    const li = document.createElement("li");
    const inputPreview = toPayloadPreview(stage.input);
    const outputPreview = toPayloadPreview(stage.output);
    const configPreview = toPayloadPreview(stage.config);
    const note = stage.notes ? `\nnotes: ${stage.notes}` : "";
    li.textContent =
      `${new Date(stage.ts).toLocaleTimeString()} · ${stage.stage}` +
      `\ninput: ${inputPreview}` +
      `\nconfig: ${configPreview}` +
      `\noutput: ${outputPreview}${note}`;
    elements.eventsList.appendChild(li);
  }
}

async function loadSettings() {
  const stored = await storageGet([STORAGE_KEY]);
  const settings = stored[STORAGE_KEY] || DEFAULTS;
  elements.apiBaseUrl.value = settings.apiBaseUrl || DEFAULTS.apiBaseUrl;
  elements.apiToken.value = settings.token || DEFAULTS.token;
}

async function saveSettings() {
  const settings = {
    apiBaseUrl: elements.apiBaseUrl.value.trim() || DEFAULTS.apiBaseUrl,
    token: elements.apiToken.value.trim() || DEFAULTS.token,
  };
  await storageSet({ [STORAGE_KEY]: settings });
}

async function getSettings() {
  const stored = await storageGet([STORAGE_KEY]);
  return stored[STORAGE_KEY] || DEFAULTS;
}

function normalizeApiBaseUrl(input) {
  const raw = String(input || "").trim();
  const fallback = DEFAULTS.apiBaseUrl;
  return (raw || fallback).replace(/\/$/, "");
}

function buildApiBaseCandidates(inputBaseUrl) {
  const primary = normalizeApiBaseUrl(inputBaseUrl);
  const out = [primary];
  try {
    const parsed = new URL(primary);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.port === "8080") {
      if (parsed.hostname === "localhost") {
        const alt = new URL(parsed.toString());
        alt.hostname = "127.0.0.1";
        out.push(alt.toString().replace(/\/$/, ""));
      } else if (parsed.hostname === "127.0.0.1") {
        const alt = new URL(parsed.toString());
        alt.hostname = "localhost";
        out.push(alt.toString().replace(/\/$/, ""));
      }
    }
  } catch (_error) {
    // Keep primary only; fetch will surface invalid URL errors.
  }
  return Array.from(new Set(out));
}

function isLikelyNetworkFetchError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "TypeError") {
    return true;
  }
  return /(failed to fetch|fetch failed|networkerror|load failed|net::)/i.test(error.message);
}

function formatNetworkFetchMessage(path, triedBaseUrls, error) {
  const triedLines = triedBaseUrls.map((baseUrl) => `- ${baseUrl}${path}`).join("\n");
  const browserMessage = error instanceof Error ? error.message : "Failed to fetch";
  return [
    "无法连接到后端 API（网络请求失败）。",
    "已尝试请求：",
    triedLines,
    "排查建议：",
    "1) 确认后端在运行：打开 http://localhost:8080/healthz，应该返回 ok。",
    "2) 检查 API Base URL（建议 http://localhost:8080）。",
    "3) 检查 Token 是否有效（例如 dev:cecilia@example.com）。",
    "4) 在项目根目录执行 ./scripts/dev-up.sh；再用 ./scripts/dev-smoke.sh 验证。",
    "5) 若仍不通，单独启动后端：cd backend && npm run start。",
    `浏览器错误：${browserMessage}`,
  ].join("\n");
}

async function storageGet(keys) {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local.get(keys);
  }
  const keyList = Array.isArray(keys) ? keys : [keys];
  const output = {};
  for (const key of keyList) {
    const raw = localStorage.getItem(key);
    if (raw == null) {
      continue;
    }
    try {
      output[key] = JSON.parse(raw);
    } catch (_error) {
      output[key] = raw;
    }
  }
  return output;
}

async function storageSet(value) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set(value);
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    localStorage.setItem(key, JSON.stringify(val));
  }
}

async function apiRequest(path, method, body) {
  const settings = await getSettings();
  const baseCandidates = buildApiBaseCandidates(settings.apiBaseUrl);
  const requestBodyPreview = toPayloadPreview(body);
  let lastNetworkError = null;

  for (let index = 0; index < baseCandidates.length; index += 1) {
    const baseUrl = baseCandidates[index];
    const requestUrl = `${baseUrl}${path}`;
    try {
      const response = await fetch(requestUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch (_error) {
          payload = null;
        }
        pushPayloadLog({
          ts: new Date().toISOString(),
          method,
          path,
          url: requestUrl,
          kind: "http",
          status: response.status,
          requestBody: requestBodyPreview,
          responseBody: toPayloadPreview(payload ?? `HTTP ${response.status}`),
        });
        const code = payload?.error?.code || "UNKNOWN_ERROR";
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`${code}: ${message}`);
      }

      const jsonBody = await response.json();
      pushPayloadLog({
        ts: new Date().toISOString(),
        method,
        path,
        url: requestUrl,
        kind: "http",
        status: response.status,
        requestBody: requestBodyPreview,
        responseBody: toPayloadPreview(jsonBody),
      });

      if (index > 0 && !didAutoSwitchBaseUrl) {
        didAutoSwitchBaseUrl = true;
        const nextSettings = { ...settings, apiBaseUrl: baseUrl };
        await storageSet({ [STORAGE_KEY]: nextSettings });
        elements.apiBaseUrl.value = baseUrl;
        showSettingsFeedback(`Connected via ${baseUrl}. API Base URL auto-updated.`);
      }

      return jsonBody;
    } catch (error) {
      if (isLikelyNetworkFetchError(error)) {
        pushPayloadLog({
          ts: new Date().toISOString(),
          method,
          path,
          url: requestUrl,
          kind: "network_error",
          requestBody: requestBodyPreview,
          responseBody: toPayloadPreview(error instanceof Error ? error.message : "Failed to fetch"),
        });
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  throw new Error(formatNetworkFetchMessage(path, baseCandidates, lastNetworkError));
}

async function fetchStatus(jobId) {
  const data = await apiRequest(`/v1/jobs/${jobId}`, "GET");
  renderStatus(data);
  return data;
}

async function fetchArtifacts(jobId) {
  const data = await apiRequest(`/v1/jobs/${jobId}/artifacts`, "GET");
  renderArtifacts(data);
}

async function fetchInspector(jobId) {
  const data = await apiRequest(`/v1/jobs/${jobId}/inspector`, "GET");
  renderInspector(data);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function startPolling(jobId) {
  stopPolling();
  await storageSet({ [LAST_JOB_KEY]: jobId });
  pollTimer = setInterval(async () => {
    try {
      clearError();
      const job = await fetchStatus(jobId);
      await fetchInspector(jobId);
      if (job.status === "succeeded") {
        await fetchArtifacts(jobId);
        stopPolling();
      }
      if (job.status === "failed" || job.status === "canceled") {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      renderError(error instanceof Error ? error.message : "Unknown polling error");
    }
  }, 1200);
}

async function handleCreateJob(event) {
  event.preventDefault();
  clearError();
  elements.submitJob.disabled = true;
  elements.submitJob.textContent = "Submitting...";
  try {
    await saveSettings();
    if (!elements.checkPersonal.checked || !elements.checkNonCommercial.checked) {
      throw new Error("Compliance declarations must be checked.");
    }

    const resolvedTitle = elements.title.value.trim() || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const payload = {
      title: resolvedTitle,
      language: elements.language.value.trim(),
      transcript_text: elements.transcriptText.value,
      template_id: elements.templateId.value.trim() || "templateA-v0-book",
      output_formats: ["epub", "pdf", "md"],
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
      compliance_declaration: {
        for_personal_or_authorized_use_only: true,
        no_commercial_use: true,
      },
    };
    const created = await apiRequest("/v1/jobs/from-transcript", "POST", payload);
    renderStatus({ job_id: created.job_id, status: created.status, progress: 0, stage: "queued" });
    elements.artifactsList.innerHTML = "<li>Waiting for artifacts...</li>";
    elements.eventsList.innerHTML = "<li>Waiting for inspector stages...</li>";
    await startPolling(created.job_id);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Failed to submit job");
  } finally {
    elements.submitJob.disabled = false;
    elements.submitJob.textContent = "Generate EPUB / PDF / Markdown";
  }
}

function loadSample() {
  elements.title.value = "Sample Dense Podcast Episode";
  elements.language.value = "zh-CN";
  elements.templateId.value = "templateA-v0-book";
  elements.episodeUrl.value = "https://example.com/episodes/sample";
  elements.transcriptText.value =
    "主持人：今天我们讨论如何把播客内容沉淀成可复用知识资产。\n嘉宾：先明确问题边界，再拆分结构，最后形成行动清单。\n主持人：如果听众只记住一件事，那就是把输入转成可执行输出。";
}

async function restoreLastJob() {
  const stored = await storageGet([LAST_JOB_KEY]);
  const lastJob = stored[LAST_JOB_KEY];
  if (!lastJob) {
    return;
  }
  try {
    const status = await fetchStatus(lastJob);
    await fetchInspector(lastJob);
    if (status.status === "succeeded") {
      await fetchArtifacts(lastJob);
      return;
    }
    if (status.status === "queued" || status.status === "processing") {
      await startPolling(lastJob);
    }
  } catch (_error) {
    // Ignore restore errors; user can submit a new job.
  }
}

async function init() {
  elements.form.addEventListener("submit", handleCreateJob);
  elements.saveSettings.addEventListener("click", async () => {
    try {
      elements.saveSettings.disabled = true;
      elements.saveSettings.textContent = "Saving...";
      await saveSettings();
      showSettingsFeedback("Settings saved.");
    } catch (error) {
      showSettingsFeedback(
        error instanceof Error ? `Save failed: ${error.message}` : "Save failed.",
        true,
      );
    } finally {
      elements.saveSettings.disabled = false;
      elements.saveSettings.textContent = "Save Settings";
    }
  });
  elements.loadSample.addEventListener("click", loadSample);
  elements.topTabWorkspace.addEventListener("click", () => setActiveTab("workspace"));
  elements.topTabPayload.addEventListener("click", () => setActiveTab("payload"));
  elements.clearPayloadLogs.addEventListener("click", () => {
    payloadLogs.splice(0, payloadLogs.length);
    renderPayloadLogs();
  });
  setActiveTab(activeTab);
  renderPayloadLogs();
  await loadSettings();
  await restoreLastJob();
}

void init();
