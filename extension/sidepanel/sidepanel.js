import {
  DEFAULT_LLM_SETTINGS,
  LLM_INPUT_MAX_CHARS,
  createBookletDraftFromOutline,
  createBookletOutlineFromWorkingNotes,
  createWorkingNotesFromTranscript,
} from "./local-pipeline.js";
import { createEpubFromBookletDraft } from "./local-epub.js";

const SETTINGS_KEY = "pte_settings_v2";
const WORKSPACE_KEY = "pte_workspace_v1";
const EMPTY_ARTIFACTS_HTML = "<li>尚未导出 EPUB。</li>";

const elements = {
  llmBaseUrl: document.getElementById("llm-base-url"),
  llmApiKey: document.getElementById("llm-api-key"),
  llmModel: document.getElementById("llm-model"),
  saveSettings: document.getElementById("save-settings"),
  loadSample: document.getElementById("load-sample"),
  settingsFeedback: document.getElementById("settings-feedback"),
  form: document.getElementById("transcript-form"),
  title: document.getElementById("title"),
  language: document.getElementById("language"),
  episodeUrl: document.getElementById("episode-url"),
  transcriptText: document.getElementById("transcript-text"),
  generateWorkingNotes: document.getElementById("generate-working-notes"),
  generateBookletOutline: document.getElementById("generate-booklet-outline"),
  generateBookletDraft: document.getElementById("generate-booklet-draft"),
  submitJob: document.getElementById("submit-job"),
  jobId: document.getElementById("job-id"),
  jobStatus: document.getElementById("job-status"),
  jobStage: document.getElementById("job-stage"),
  jobProgress: document.getElementById("job-progress"),
  meterFill: document.getElementById("meter-fill"),
  errorBox: document.getElementById("error-box"),
  artifactsList: document.getElementById("artifacts-list"),
  workingNotesEmpty: document.getElementById("working-notes-empty"),
  workingNotesPanel: document.getElementById("working-notes-panel"),
  workingNotesSummary: document.getElementById("working-notes-summary"),
  workingNotesSections: document.getElementById("working-notes-sections"),
  bookletOutlineEmpty: document.getElementById("booklet-outline-empty"),
  bookletOutlinePanel: document.getElementById("booklet-outline-panel"),
  bookletOutlineTitle: document.getElementById("booklet-outline-title"),
  bookletOutlineSections: document.getElementById("booklet-outline-sections"),
  bookletDraftEmpty: document.getElementById("booklet-draft-empty"),
  bookletDraftPanel: document.getElementById("booklet-draft-panel"),
  bookletDraftTitle: document.getElementById("booklet-draft-title"),
  bookletDraftSections: document.getElementById("booklet-draft-sections"),
  eventsList: document.getElementById("events-list"),
};

let latestWorkingNotes = null;
let latestBookletOutline = null;
let latestBookletDraft = null;
let latestStatus = {
  job_id: "-",
  status: "idle",
  stage: "-",
  progress: 0,
};
let latestStages = [];
let latestArtifactSummary = null;
let generatedArtifactUrls = [];
let workspaceSaveTimer = null;

const STATUS_LABELS = {
  idle: "待命",
  queued: "排队中",
  processing: "处理中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const STAGE_LABELS = {
  transcript: "Transcript",
  queued: "排队",
  ingest: "输入处理",
  normalization: "规范化",
  llm_request: "模型请求",
  llm_response: "模型响应",
  render: "渲染",
  pdf: "PDF 渲染",
  epub: "EPUB 渲染",
  finalize: "收尾",
  completed: "完成",
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

function toJsonPreview(value, maxChars = 6_000) {
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
  latestStatus = {
    job_id: data?.job_id || "-",
    status: data?.status || "idle",
    stage: data?.stage || "-",
    progress: Number(data?.progress || 0),
  };
  elements.jobId.textContent = latestStatus.job_id;
  elements.jobStatus.textContent = localizeStatus(latestStatus.status);
  elements.jobStage.textContent = localizeStage(latestStatus.stage);
  elements.jobProgress.textContent = `${latestStatus.progress}%`;
  elements.meterFill.style.width = `${Math.min(100, Math.max(0, latestStatus.progress))}%`;
}

function revokeArtifactUrls() {
  for (const url of generatedArtifactUrls) {
    URL.revokeObjectURL(url);
  }
  generatedArtifactUrls = [];
}

function renderArtifacts(data) {
  revokeArtifactUrls();
  elements.artifactsList.innerHTML = "";
  const items = Array.isArray(data?.artifacts) ? data.artifacts : [];
  if (!items.length) {
    elements.artifactsList.innerHTML = EMPTY_ARTIFACTS_HTML;
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "artifact-item";
    const details = item.expires_at ? `过期时间 ${new Date(item.expires_at).toLocaleString()}` : "本地生成";
    if (typeof item.download_url === "string" && item.download_url.startsWith("blob:")) {
      generatedArtifactUrls.push(item.download_url);
    }
    li.innerHTML = `<a class="artifact-card-link" href="${item.download_url}" download="${item.file_name}" target="_blank" rel="noreferrer">
      <div class="artifact-type">${item.type.toUpperCase()}</div>
      <div>${item.file_name}</div>
      <div>${item.size_bytes} 字节 · ${details}</div>
    </a>`;
    elements.artifactsList.appendChild(li);
  }
}

function renderArtifactSummary(summary) {
  revokeArtifactUrls();
  if (!summary) {
    elements.artifactsList.innerHTML = EMPTY_ARTIFACTS_HTML;
    return;
  }
  elements.artifactsList.innerHTML = `<li class="artifact-item">上次本地导出：${summary.file_name} · ${summary.size_bytes} 字节。若要再次下载，请重新点击“导出 EPUB”。</li>`;
}

function renderWorkingNotes(data) {
  const notes = data?.working_notes;
  latestWorkingNotes = notes || null;
  elements.workingNotesSummary.innerHTML = "";
  elements.workingNotesSections.innerHTML = "";
  if (!notes?.summary?.length || !notes?.sections?.length) {
    elements.workingNotesEmpty.hidden = false;
    elements.workingNotesPanel.hidden = true;
    return;
  }

  for (const item of notes.summary) {
    const li = document.createElement("li");
    li.textContent = item;
    elements.workingNotesSummary.appendChild(li);
  }

  for (const section of notes.sections) {
    const article = document.createElement("article");
    article.className = "working-note-section";

    const title = document.createElement("h4");
    title.textContent = section.heading;
    article.appendChild(title);

    const bullets = document.createElement("ul");
    for (const bullet of section.bullets || []) {
      const li = document.createElement("li");
      li.textContent = bullet;
      bullets.appendChild(li);
    }
    article.appendChild(bullets);

    const excerpts = document.createElement("div");
    excerpts.className = "working-note-excerpts";
    for (const excerpt of section.excerpts || []) {
      const block = document.createElement("blockquote");
      block.className = "working-note-excerpt";
      block.textContent = excerpt;
      excerpts.appendChild(block);
    }
    article.appendChild(excerpts);
    elements.workingNotesSections.appendChild(article);
  }

  elements.workingNotesEmpty.hidden = true;
  elements.workingNotesPanel.hidden = false;
}

function clearBookletOutline() {
  latestBookletOutline = null;
  elements.bookletOutlineTitle.textContent = "";
  elements.bookletOutlineSections.innerHTML = "";
  elements.bookletOutlineEmpty.hidden = false;
  elements.bookletOutlinePanel.hidden = true;
}

function renderBookletOutline(data) {
  const outline = data?.booklet_outline;
  latestBookletOutline = outline || null;
  elements.bookletOutlineSections.innerHTML = "";
  if (!outline?.sections?.length) {
    clearBookletOutline();
    return;
  }

  elements.bookletOutlineTitle.textContent = outline.title || "未命名 Outline";
  for (const section of outline.sections) {
    const li = document.createElement("li");
    li.className = "outline-section";

    const heading = document.createElement("strong");
    heading.textContent = section.heading;
    li.appendChild(heading);

    if (section.goal) {
      const goal = document.createElement("p");
      goal.className = "outline-goal";
      goal.textContent = section.goal;
      li.appendChild(goal);
    }

    elements.bookletOutlineSections.appendChild(li);
  }

  elements.bookletOutlineEmpty.hidden = true;
  elements.bookletOutlinePanel.hidden = false;
}

function clearBookletDraft() {
  latestBookletDraft = null;
  elements.bookletDraftTitle.textContent = "";
  elements.bookletDraftSections.innerHTML = "";
  elements.bookletDraftEmpty.hidden = false;
  elements.bookletDraftPanel.hidden = true;
}

function renderBookletDraft(data) {
  const draft = data?.booklet_draft;
  latestBookletDraft = draft || null;
  elements.bookletDraftSections.innerHTML = "";
  if (!draft?.sections?.length) {
    clearBookletDraft();
    return;
  }

  elements.bookletDraftTitle.textContent = draft.title || "未命名 Draft";
  for (const section of draft.sections) {
    const article = document.createElement("article");
    article.className = "draft-section";

    const heading = document.createElement("h4");
    heading.textContent = section.heading;
    article.appendChild(heading);

    const paragraphs = String(section.body || "")
      .split(/\n{2,}/)
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const p = document.createElement("p");
      p.textContent = paragraph;
      article.appendChild(p);
    }

    elements.bookletDraftSections.appendChild(article);
  }

  elements.bookletDraftEmpty.hidden = true;
  elements.bookletDraftPanel.hidden = false;
}

function renderInspector(data) {
  latestStages = Array.isArray(data?.stages) ? data.stages : [];
  elements.eventsList.innerHTML = "";
  if (!latestStages.length) {
    elements.eventsList.innerHTML = "<li>暂无调试阶段信息。</li>";
    return;
  }
  for (const stage of latestStages) {
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

function getStorageArea() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("此页面必须运行在 Chrome 扩展环境里，才能使用本地工作区存储。");
  }
  return chrome.storage.local;
}

async function storageGet(keys) {
  return getStorageArea().get(keys);
}

async function storageSet(value) {
  await getStorageArea().set(value);
}

function normalizeLlmBaseUrl(input) {
  return String(input || DEFAULT_LLM_SETTINGS.llmBaseUrl).trim().replace(/\/$/, "");
}

async function loadSettings() {
  const stored = await storageGet([SETTINGS_KEY]);
  const settings = stored[SETTINGS_KEY] || DEFAULT_LLM_SETTINGS;
  elements.llmBaseUrl.value = settings.llmBaseUrl || DEFAULT_LLM_SETTINGS.llmBaseUrl;
  elements.llmApiKey.value = settings.llmApiKey || "";
  elements.llmModel.value = settings.llmModel || DEFAULT_LLM_SETTINGS.llmModel;
}

async function saveSettings() {
  const settings = {
    llmBaseUrl: normalizeLlmBaseUrl(elements.llmBaseUrl.value),
    llmApiKey: String(elements.llmApiKey.value || "").trim(),
    llmModel: String(elements.llmModel.value || DEFAULT_LLM_SETTINGS.llmModel).trim() || DEFAULT_LLM_SETTINGS.llmModel,
  };
  await storageSet({ [SETTINGS_KEY]: settings });
  return settings;
}

async function getSettings() {
  const stored = await storageGet([SETTINGS_KEY]);
  return stored[SETTINGS_KEY] || { ...DEFAULT_LLM_SETTINGS };
}

function collectWorkspaceSnapshot() {
  return {
    title: elements.title.value,
    language: elements.language.value,
    episodeUrl: elements.episodeUrl.value,
    transcriptText: elements.transcriptText.value,
    workingNotes: latestWorkingNotes,
    bookletOutline: latestBookletOutline,
    bookletDraft: latestBookletDraft,
    status: latestStatus,
    stages: latestStages,
    artifactSummary: latestArtifactSummary,
    savedAt: new Date().toISOString(),
  };
}

async function persistWorkspace() {
  await storageSet({ [WORKSPACE_KEY]: collectWorkspaceSnapshot() });
}

function scheduleWorkspaceSave() {
  if (workspaceSaveTimer) {
    clearTimeout(workspaceSaveTimer);
  }
  workspaceSaveTimer = setTimeout(() => {
    void persistWorkspace().catch((error) => {
      console.error(error);
    });
  }, 250);
}

async function loadWorkspace() {
  const stored = await storageGet([WORKSPACE_KEY]);
  return stored[WORKSPACE_KEY] || null;
}

function restoreWorkspace(workspace) {
  if (!workspace) {
    renderStatus(latestStatus);
    renderInspector({ stages: [] });
    renderArtifactSummary(null);
    return;
  }

  elements.title.value = workspace.title || "";
  elements.language.value = workspace.language || "zh-CN";
  elements.episodeUrl.value = workspace.episodeUrl || "";
  elements.transcriptText.value = workspace.transcriptText || "";

  renderStatus(workspace.status || latestStatus);
  renderInspector({ stages: workspace.stages || [] });

  if (workspace.workingNotes) {
    renderWorkingNotes({ working_notes: workspace.workingNotes });
  } else {
    renderWorkingNotes({});
  }

  if (workspace.bookletOutline) {
    renderBookletOutline({ booklet_outline: workspace.bookletOutline });
  } else {
    clearBookletOutline();
  }

  if (workspace.bookletDraft) {
    renderBookletDraft({ booklet_draft: workspace.bookletDraft });
  } else {
    clearBookletDraft();
  }

  latestArtifactSummary = workspace.artifactSummary || null;
  renderArtifactSummary(latestArtifactSummary);
}

function updateSuccessfulRun(response) {
  renderStatus({
    job_id: response.job_id,
    status: response.status,
    progress: 100,
    stage: "completed",
  });
  renderInspector({ stages: response.stages });
}

async function handleCreateJob(event) {
  event.preventDefault();
  clearError();
  elements.submitJob.disabled = true;
  elements.submitJob.textContent = "导出中...";
  try {
    if (!latestBookletDraft?.sections?.length) {
      throw new Error("请先生成 Booklet Draft。");
    }

    const resolvedTitle = elements.title.value.trim() || latestBookletDraft.title || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const created = await createEpubFromBookletDraft({
      title: resolvedTitle,
      language: elements.language.value.trim(),
      bookletDraft: latestBookletDraft,
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
    });

    const objectUrl = URL.createObjectURL(created.blob);
    created.artifacts[0].download_url = objectUrl;

    latestArtifactSummary = {
      file_name: created.artifacts[0].file_name,
      size_bytes: created.artifacts[0].size_bytes,
      created_at: created.created_at,
    };

    updateSuccessfulRun(created);
    renderArtifacts(created);
    await persistWorkspace();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "导出 EPUB 失败");
  } finally {
    elements.submitJob.disabled = false;
    elements.submitJob.textContent = "导出 EPUB";
  }
}

async function handleGenerateWorkingNotes() {
  clearError();
  elements.generateWorkingNotes.disabled = true;
  elements.generateWorkingNotes.textContent = "生成中...";
  try {
    const settings = await saveSettings();
    const resolvedTitle = elements.title.value.trim() || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const created = await createWorkingNotesFromTranscript({
      settings,
      title: resolvedTitle,
      language: elements.language.value.trim(),
      transcriptText: elements.transcriptText.value,
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
    });

    latestArtifactSummary = null;
    updateSuccessfulRun(created);
    renderArtifactSummary(null);
    clearBookletOutline();
    clearBookletDraft();
    renderWorkingNotes(created);
    await persistWorkspace();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Working Notes 生成失败");
  } finally {
    elements.generateWorkingNotes.disabled = false;
    elements.generateWorkingNotes.textContent = "先看 Working Notes";
  }
}

async function handleGenerateBookletOutline() {
  clearError();
  elements.generateBookletOutline.disabled = true;
  elements.generateBookletOutline.textContent = "生成中...";
  try {
    if (!latestWorkingNotes?.sections?.length) {
      throw new Error("请先生成 Working Notes。");
    }

    const settings = await saveSettings();
    const resolvedTitle = elements.title.value.trim() || latestWorkingNotes.title || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const created = await createBookletOutlineFromWorkingNotes({
      settings,
      title: resolvedTitle,
      language: elements.language.value.trim(),
      workingNotes: latestWorkingNotes,
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
    });

    latestArtifactSummary = null;
    updateSuccessfulRun(created);
    renderArtifactSummary(null);
    clearBookletDraft();
    renderBookletOutline(created);
    await persistWorkspace();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Booklet Outline 生成失败");
  } finally {
    elements.generateBookletOutline.disabled = false;
    elements.generateBookletOutline.textContent = "继续生成 Outline";
  }
}

async function handleGenerateBookletDraft() {
  clearError();
  elements.generateBookletDraft.disabled = true;
  elements.generateBookletDraft.textContent = "生成中...";
  try {
    if (!latestWorkingNotes?.sections?.length) {
      throw new Error("请先生成 Working Notes。");
    }
    if (!latestBookletOutline?.sections?.length) {
      throw new Error("请先生成 Booklet Outline。");
    }

    const settings = await saveSettings();
    const resolvedTitle =
      elements.title.value.trim() || latestBookletOutline.title || latestWorkingNotes.title || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;

    const created = await createBookletDraftFromOutline({
      settings,
      title: resolvedTitle,
      language: elements.language.value.trim(),
      workingNotes: latestWorkingNotes,
      bookletOutline: latestBookletOutline,
      metadata: {
        episode_url: elements.episodeUrl.value.trim() || undefined,
      },
    });

    latestArtifactSummary = null;
    updateSuccessfulRun(created);
    renderArtifactSummary(null);
    renderBookletDraft(created);
    await persistWorkspace();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Booklet Draft 生成失败");
  } finally {
    elements.generateBookletDraft.disabled = false;
    elements.generateBookletDraft.textContent = "继续生成 Draft";
  }
}

function loadSample() {
  elements.title.value = "示例播客：从信息输入到可执行输出";
  elements.language.value = "zh-CN";
  elements.episodeUrl.value = "https://example.com/episodes/sample";
  elements.transcriptText.value =
    "主持人：今天我们讨论如何把播客内容沉淀成可复用知识资产。\n嘉宾：先明确问题边界，再拆分结构，最后形成行动清单。\n主持人：如果听众只记住一件事，那就是把输入转成可执行输出。";
  scheduleWorkspaceSave();
}

function registerWorkspaceInputs() {
  for (const element of [elements.title, elements.language, elements.episodeUrl, elements.transcriptText]) {
    element.addEventListener("input", scheduleWorkspaceSave);
    element.addEventListener("change", scheduleWorkspaceSave);
  }
}

async function init() {
  elements.transcriptText.maxLength = LLM_INPUT_MAX_CHARS;
  elements.form.addEventListener("submit", handleCreateJob);
  elements.saveSettings.addEventListener("click", async () => {
    try {
      elements.saveSettings.disabled = true;
      elements.saveSettings.textContent = "保存中...";
      await saveSettings();
      showSettingsFeedback("模型设置已保存。API key 只存在当前 Chrome 本地。");
    } catch (error) {
      showSettingsFeedback(error instanceof Error ? `保存失败：${error.message}` : "保存失败。", true);
    } finally {
      elements.saveSettings.disabled = false;
      elements.saveSettings.textContent = "保存设置";
    }
  });
  elements.loadSample.addEventListener("click", loadSample);
  elements.generateWorkingNotes.addEventListener("click", handleGenerateWorkingNotes);
  elements.generateBookletOutline.addEventListener("click", handleGenerateBookletOutline);
  elements.generateBookletDraft.addEventListener("click", handleGenerateBookletDraft);
  registerWorkspaceInputs();
  await loadSettings();
  const workspace = await loadWorkspace();
  restoreWorkspace(workspace);
  const settings = await getSettings();
  if (settings.llmApiKey) {
    showSettingsFeedback("工作区已恢复。现在会直接从扩展请求模型，不再依赖 localhost。");
  } else {
    showSettingsFeedback("先填入 API key，然后就可以直接在扩展里跑完整流程。");
  }
}

void init().catch((error) => {
  renderError(error instanceof Error ? error.message : "初始化失败");
});
