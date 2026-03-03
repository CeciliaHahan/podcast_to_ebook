const STORAGE_KEY = "pte_settings_v1";
const LAST_JOB_KEY = "pte_last_job_v1";
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
};

let pollTimer = null;
let didAutoSwitchBaseUrl = false;
const STATUS_LABELS = {
  idle: "待命",
  queued: "排队中",
  processing: "处理中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const STAGE_LABELS = {
  queued: "排队",
  ingest: "输入处理",
  normalization: "规范化",
  llm_request: "模型请求",
  llm_response: "模型响应",
  render: "渲染",
  pdf: "PDF 渲染",
  epub: "EPUB 渲染",
  finalize: "收尾",
};

function sanitizeGeneratedTitle(rawTitle) {
  return String(rawTitle || "")
    .replace(/^\s*(?:>\s*)?[#]{1,6}\s*/, "")
    .replace(/^\s*[\-*•]\s*/, "")
    .replace(/^\s*[\*_"'`~]{1,3}\s*/, "")
    .replace(/\s*[\*_"'`~]{1,3}\s*$/, "")
    .replace(/^\s*[\s:：\-，,。.!！?？]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyGreetingPreamble(line) {
  return /(hello|hi|大家好|欢迎收听|我是|在你听这期|想跟大家说|先跟大家说)/i.test(String(line || ""));
}

function extractKeywordBasedTitle(transcript) {
  const text = String(transcript || "");
  const match = text.match(/keywords\s*:\s*([\s\S]*?)\btranscript\s*:/i);
  if (!match || !match[1]) {
    return "";
  }
  const parts = match[1]
    .split(/[\n、，,]/)
    .map((item) => sanitizeGeneratedTitle(item))
    .filter((item) => item.length >= 2);
  if (!parts.length) {
    return "";
  }
  return `圆桌讨论：${parts.slice(0, 3).join(" / ")}`.slice(0, 60);
}

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
    const cleaned = sanitizeGeneratedTitle(rawLine)
      .replace(/^(speaker\s*\d+|host|guest|主持人|嘉宾)\s*[0-9:：\s-]*[:：-]?\s*/i, "")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
      .trim();
    if (cleaned.length >= 6 && isLikelyGreetingPreamble(cleaned) && cleaned.length > 20) {
      continue;
    }
    if (cleaned.length >= 6) {
      return cleaned.slice(0, 60);
    }
  }

  const keywordTitle = extractKeywordBasedTitle(transcript);
  if (keywordTitle) {
    return keywordTitle;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  return `播客笔记 ${dateStr}`;
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

function toJsonPreview(value, maxChars = 6000) {
  if (value === undefined) {
    return "（无）";
  }
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch (_error) {
    text = String(value);
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... <已截断>`;
}

function localizeStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  return STATUS_LABELS[key] || status || "待命";
}

function localizeStage(stage) {
  const key = String(stage || "").trim().toLowerCase();
  return STAGE_LABELS[key] || stage || "-";
}

function renderStatus(data) {
  elements.jobId.textContent = data.job_id || "-";
  elements.jobStatus.textContent = localizeStatus(data.status);
  elements.jobStage.textContent = localizeStage(data.stage);
  const progress = Number(data.progress || 0);
  elements.jobProgress.textContent = `${progress}%`;
  elements.meterFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function renderArtifacts(data) {
  elements.artifactsList.innerHTML = "";
  if (!data?.artifacts?.length) {
    elements.artifactsList.innerHTML = "<li>暂无可下载产物。</li>";
    return;
  }
  for (const item of data.artifacts) {
    const li = document.createElement("li");
    li.className = "artifact-item";
    li.innerHTML = `<a class="artifact-card-link" href="${item.download_url}" target="_blank" rel="noreferrer">
      <div class="artifact-type">${item.type.toUpperCase()}</div>
      <div>${item.file_name}</div>
      <div>${item.size_bytes} 字节 · 过期时间 ${new Date(item.expires_at).toLocaleString()}</div>
    </a>`;
    elements.artifactsList.appendChild(li);
  }
}

function renderInspector(data) {
  elements.eventsList.innerHTML = "";
  if (!data?.stages?.length) {
    elements.eventsList.innerHTML = "<li>暂无调试阶段信息。</li>";
    return;
  }
  for (const stage of data.stages) {
    const li = document.createElement("li");
    const note = stage.notes ? `\n备注: ${stage.notes}` : "";
    li.textContent =
      `${new Date(stage.ts).toLocaleTimeString()} · ${localizeStage(stage.stage)}` +
      `\n输入: ${toJsonPreview(stage.input)}` +
      `\n配置: ${toJsonPreview(stage.config)}` +
      `\n输出: ${toJsonPreview(stage.output)}${note}`;
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
  const browserMessage = error instanceof Error ? error.message : "请求失败";
  return [
    "无法连接到后端 API（网络请求失败）。",
    "已尝试请求：",
    triedLines,
    "排查建议：",
    "1) 确认后端在运行：打开 http://localhost:8080/healthz，应该返回 ok。",
    "2) 检查 API 地址（建议 http://localhost:8080）。",
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
        const code = payload?.error?.code || "UNKNOWN_ERROR";
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`${code}: ${message}`);
      }

      const jsonBody = await response.json();
      if (index > 0 && !didAutoSwitchBaseUrl) {
        didAutoSwitchBaseUrl = true;
        const nextSettings = { ...settings, apiBaseUrl: baseUrl };
        await storageSet({ [STORAGE_KEY]: nextSettings });
        elements.apiBaseUrl.value = baseUrl;
        showSettingsFeedback(`已自动切换到可连接地址：${baseUrl}`);
      }
      return jsonBody;
    } catch (error) {
      if (isLikelyNetworkFetchError(error)) {
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
      renderError(error instanceof Error ? error.message : "轮询状态失败");
    }
  }, 1200);
}

async function handleCreateJob(event) {
  event.preventDefault();
  clearError();
  elements.submitJob.disabled = true;
  elements.submitJob.textContent = "提交中...";
  try {
    await saveSettings();
    if (!elements.checkPersonal.checked || !elements.checkNonCommercial.checked) {
      throw new Error("请先确认使用声明。");
    }

    const resolvedTitle = elements.title.value.trim() || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const payload = {
      title: resolvedTitle,
      language: elements.language.value.trim(),
      transcript_text: elements.transcriptText.value,
      output_formats: ["epub"],
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
      compliance_declaration: {
        for_personal_or_authorized_use_only: true,
        no_commercial_use: true,
      },
    };

    const created = await apiRequest("/v1/epub/from-transcript", "POST", payload);
    renderStatus({ job_id: created.job_id, status: created.status, progress: 0, stage: "queued" });
    elements.artifactsList.innerHTML = "<li>正在等待 EPUB 产物...</li>";
    elements.eventsList.innerHTML = "<li>正在等待调试阶段信息...</li>";
    await startPolling(created.job_id);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "提交任务失败");
  } finally {
    elements.submitJob.disabled = false;
    elements.submitJob.textContent = "开始生成 EPUB";
  }
}

function loadSample() {
  elements.title.value = "示例播客：从信息输入到可执行输出";
  elements.language.value = "zh-CN";
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
      elements.saveSettings.textContent = "保存中...";
      await saveSettings();
      showSettingsFeedback("设置已保存。");
    } catch (error) {
      showSettingsFeedback(error instanceof Error ? `保存失败：${error.message}` : "保存失败。", true);
    } finally {
      elements.saveSettings.disabled = false;
      elements.saveSettings.textContent = "保存设置";
    }
  });
  elements.loadSample.addEventListener("click", loadSample);
  await loadSettings();
  await restoreLastJob();
}

void init();
