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

const elements = {
  // Views
  viewInput: document.getElementById("view-input"),
  viewPipeline: document.getElementById("view-pipeline"),
  
  // Forms & Settings
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
  
  // Pipeline Actions
  resetPipeline: document.getElementById("reset-pipeline"),
  
  // Status Elements
  jobStatus: document.getElementById("job-status"),
  jobStage: document.getElementById("job-stage"),
  jobProgress: document.getElementById("job-progress"),
  meterFill: document.getElementById("meter-fill"),
  
  // Steps Elements
  steps: {
    notes: document.getElementById("step-notes"),
    outline: document.getElementById("step-outline"),
    draft: document.getElementById("step-draft"),
    epub: document.getElementById("step-epub"),
  },
  btns: {
    viewNotes: document.getElementById("btn-view-notes"),
    viewOutline: document.getElementById("btn-view-outline"),
    viewDraft: document.getElementById("btn-view-draft"),
  },
  epubContainer: document.getElementById("epub-download-container"),
  
  // Pipeline Utilities
  errorBox: document.getElementById("error-box"),
  eventsList: document.getElementById("events-list"),
  
  // Modals Content (Notes)
  workingNotesEmpty: document.getElementById("working-notes-empty"),
  workingNotesPanel: document.getElementById("working-notes-panel"),
  workingNotesSummary: document.getElementById("working-notes-summary"),
  workingNotesSections: document.getElementById("working-notes-sections"),
  
  // Modals Content (Outline)
  bookletOutlineEmpty: document.getElementById("booklet-outline-empty"),
  bookletOutlinePanel: document.getElementById("booklet-outline-panel"),
  bookletOutlineTitle: document.getElementById("booklet-outline-title"),
  bookletOutlineSections: document.getElementById("booklet-outline-sections"),
  
  // Modals Content (Draft)
  bookletDraftEmpty: document.getElementById("booklet-draft-empty"),
  bookletDraftPanel: document.getElementById("booklet-draft-panel"),
  bookletDraftTitle: document.getElementById("booklet-draft-title"),
  bookletDraftSections: document.getElementById("booklet-draft-sections"),
  
  // Modal Triggers
  modalOverlay: document.getElementById("modal-overlay"),
  openSettingsBtn: document.getElementById("open-settings"),
  closeModalBtns: document.querySelectorAll(".close-modal")
};

let latestWorkingNotes = null;
let latestBookletOutline = null;
let latestBookletDraft = null;
let latestStages = [];
let latestArtifactSummary = null;
let generatedArtifactUrls = [];
let workspaceSaveTimer = null;
let isPipelineRunning = false;

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

// -----------------------------------------------------------------------------
// Modals & Navigation
// -----------------------------------------------------------------------------
function openModal(modalId) {
  elements.modalOverlay.classList.remove("hidden");
  document.getElementById(modalId).classList.add("open");
}

function closeAllModals() {
  elements.modalOverlay.classList.add("hidden");
  document.querySelectorAll(".modal-panel").forEach(panel => {
    panel.classList.remove("open");
  });
}

function switchView(viewName) {
  if (viewName === "pipeline") {
    elements.viewInput.classList.remove("active-view");
    elements.viewInput.classList.add("hidden-view");
    elements.viewPipeline.classList.remove("hidden-view");
    elements.viewPipeline.classList.add("active-view");
  } else {
    elements.viewPipeline.classList.remove("active-view");
    elements.viewPipeline.classList.add("hidden-view");
    elements.viewInput.classList.remove("hidden-view");
    elements.viewInput.classList.add("active-view");
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
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
  if (!match || !match[1]) return "";
  const parts = match[1].split(/[\n、，,]/).map(item => sanitizeGeneratedTitle(item)).filter(item => item.length >= 2);
  if (!parts.length) return "";
  return `圆桌讨论：${parts.slice(0, 3).join(" / ")}`.slice(0, 60);
}

function autoGenerateTitle(transcript) {
  const body = String(transcript || "").replace(/^.*?transcript\s*:/is, "");
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const rawLine of lines) {
    if (/^(keywords|transcript)\s*:?$/i.test(rawLine)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(rawLine) && /cst|h\s*\d+\s*min/i.test(rawLine)) continue;
    const keywordParts = rawLine.split(/[、,，]/).map(part => part.trim()).filter(Boolean);
    if (keywordParts.length >= 8 && !/[。.!?！？]/.test(rawLine)) continue;
    const cleaned = sanitizeGeneratedTitle(rawLine)
      .replace(/^(speaker\s*\d+|host|guest|主持人|嘉宾)\s*[0-9:：\s-]*[:：-]?\s*/i, "")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "").trim();
    if (cleaned.length >= 6 && isLikelyGreetingPreamble(cleaned) && cleaned.length > 20) continue;
    if (cleaned.length >= 6) return cleaned.slice(0, 60);
  }
  const keywordTitle = extractKeywordBasedTitle(transcript);
  if (keywordTitle) return keywordTitle;
  return `播客笔记 ${new Date().toISOString().slice(0, 10)}`;
}

function toJsonPreview(value, maxChars = 2000) {
  if (value === undefined) return "（无）";
  let text = "";
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... <已截断>`;
}

function localizeStage(stage) {
  const key = String(stage || "").trim().toLowerCase();
  return STAGE_LABELS[key] || stage || "-";
}

function renderError(message) {
  elements.errorBox.hidden = false;
  elements.errorBox.textContent = message;
}

function clearError() {
  elements.errorBox.hidden = true;
  elements.errorBox.textContent = "";
}

function revokeArtifactUrls() {
  for (const url of generatedArtifactUrls) URL.revokeObjectURL(url);
  generatedArtifactUrls = [];
}

// -----------------------------------------------------------------------------
// UI Renderers
// -----------------------------------------------------------------------------

function updateProgress(status, stage, percentage) {
  if (elements.jobStatus) elements.jobStatus.textContent = status;
  if (elements.jobStage) elements.jobStage.textContent = stage;
  if (elements.jobProgress) elements.jobProgress.textContent = `${percentage}%`;
  if (elements.meterFill) elements.meterFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
}

function setStepState(stepKey, state, statusText) {
  const stepEl = elements.steps[stepKey];
  if (!stepEl) return;
  
  stepEl.classList.remove("active", "completed", "error");
  if (state) stepEl.classList.add(state);
  
  const statusEl = stepEl.querySelector(".step-status");
  
  if (state === "active") {
    statusEl.innerHTML = `<span class="spinner"></span>${statusText || "处理中..."}`;
  } else if (state === "completed") {
    statusEl.textContent = statusText || "完成";
    // Show view button
    const btnMap = { notes: "viewNotes", outline: "viewOutline", draft: "viewDraft" };
    const btnKey = btnMap[stepKey];
    if (btnKey) elements.btns[btnKey].hidden = false;
  } else if (state === "error") {
    statusEl.textContent = statusText || "失败";
  } else {
    statusEl.textContent = statusText || "等待中";
    const btnMap = { notes: "viewNotes", outline: "viewOutline", draft: "viewDraft" };
    const btnKey = btnMap[stepKey];
    if (btnKey) elements.btns[btnKey].hidden = true;
  }
}

function renderArtifacts(data) {
  revokeArtifactUrls();
  elements.epubContainer.innerHTML = "";
  const items = Array.isArray(data?.artifacts) ? data.artifacts : [];
  if (!items.length) return;
  
  for (const item of items) {
    if (typeof item.download_url === "string" && item.download_url.startsWith("blob:")) {
      generatedArtifactUrls.push(item.download_url);
    }
    const a = document.createElement("a");
    a.className = "artifact-card-link";
    a.href = item.download_url;
    a.download = item.file_name;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.innerHTML = `
      <div class="artifact-type">${item.type.toUpperCase()} 下载</div>
      <div>${item.file_name}</div>
    `;
    elements.epubContainer.appendChild(a);
  }
}

function renderInspector(stages) {
  latestStages = Array.isArray(stages) ? stages : [];
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
      `\n输出: ${toJsonPreview(stage.output)}${note}`;
    elements.eventsList.appendChild(li);
  }
}

function renderWorkingNotes(notes) {
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

function renderBookletOutline(outline) {
  latestBookletOutline = outline || null;
  elements.bookletOutlineSections.innerHTML = "";
  if (!outline?.sections?.length) {
    elements.bookletOutlineTitle.textContent = "";
    elements.bookletOutlineEmpty.hidden = false;
    elements.bookletOutlinePanel.hidden = true;
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

function renderBookletDraft(draft) {
  latestBookletDraft = draft || null;
  elements.bookletDraftSections.innerHTML = "";
  if (!draft?.sections?.length) {
    elements.bookletDraftTitle.textContent = "";
    elements.bookletDraftEmpty.hidden = false;
    elements.bookletDraftPanel.hidden = true;
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
      .split(/\n{2,}/).map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean);
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

// -----------------------------------------------------------------------------
// Pipeline Orchestration
// -----------------------------------------------------------------------------
function resetPipelineUI() {
  setStepState("notes", "", "等待中");
  setStepState("outline", "", "等待中");
  setStepState("draft", "", "等待中");
  setStepState("epub", "", "等待中");
  elements.epubContainer.innerHTML = "";
  updateProgress("待命", "-", 0);
  clearError();
  latestWorkingNotes = null;
  latestBookletOutline = null;
  latestBookletDraft = null;
  latestStages = [];
}

async function handleGeneratePipeline(event) {
  event.preventDefault();
  if (isPipelineRunning) return;
  isPipelineRunning = true;
  
  resetPipelineUI();
  switchView("pipeline");
  
  let currentStageAcc = [];
  
  try {
    const settings = await getSettings();
    if (!settings.llmApiKey) {
      throw new Error("API Key 未设置，请在设置中填入 API Key。");
    }

    const resolvedTitle = elements.title.value.trim() || autoGenerateTitle(elements.transcriptText.value);
    elements.title.value = resolvedTitle;
    const language = elements.language.value.trim();
    const episodeUrl = elements.episodeUrl.value.trim() || undefined;
    const transcriptText = elements.transcriptText.value;

    // STEP 1: Working Notes
    setStepState("notes", "active", "生成大纲底稿中 (约需1-2分钟)...");
    updateProgress("处理中", "模型请求 (1/3)", 10);
    const notesRes = await createWorkingNotesFromTranscript({
      settings, title: resolvedTitle, language, transcriptText, metadata: { episode_url: episodeUrl }
    });
    currentStageAcc = currentStageAcc.concat(notesRes.stages || []);
    renderInspector(currentStageAcc);
    renderWorkingNotes(notesRes.working_notes);
    setStepState("notes", "completed");
    updateProgress("处理中", "Working Notes 完成", 25);
    
    // STEP 2: Booklet Outline
    setStepState("outline", "active", "整理章节结构中...");
    updateProgress("处理中", "模型请求 (2/3)", 35);
    const outlineRes = await createBookletOutlineFromWorkingNotes({
      settings, title: resolvedTitle, language, workingNotes: latestWorkingNotes, metadata: { episode_url: episodeUrl }
    });
    currentStageAcc = currentStageAcc.concat(outlineRes.stages || []);
    renderInspector(currentStageAcc);
    renderBookletOutline(outlineRes.booklet_outline);
    setStepState("outline", "completed");
    updateProgress("处理中", "Outline 完成", 50);

    // STEP 3: Booklet Draft
    setStepState("draft", "active", "撰写正文中 (约需2-3分钟)...");
    updateProgress("处理中", "模型请求 (3/3)", 60);
    const draftRes = await createBookletDraftFromOutline({
      settings, title: resolvedTitle, language, workingNotes: latestWorkingNotes, bookletOutline: latestBookletOutline, metadata: { episode_url: episodeUrl }
    });
    currentStageAcc = currentStageAcc.concat(draftRes.stages || []);
    renderInspector(currentStageAcc);
    renderBookletDraft(draftRes.booklet_draft);
    setStepState("draft", "completed");
    updateProgress("处理中", "Draft 完成", 75);

    // STEP 4: Export EPUB
    setStepState("epub", "active", "打包 EPUB 文件中...");
    updateProgress("处理中", "EPUB 渲染", 90);
    const epubRes = await createEpubFromBookletDraft({
      title: resolvedTitle, language, bookletDraft: latestBookletDraft, metadata: { episode_url: episodeUrl }
    });
    const objectUrl = URL.createObjectURL(epubRes.blob);
    epubRes.artifacts[0].download_url = objectUrl;
    currentStageAcc = currentStageAcc.concat(epubRes.stages || []);
    renderInspector(currentStageAcc);
    renderArtifacts(epubRes);
    
    latestArtifactSummary = {
      file_name: epubRes.artifacts[0].file_name,
      size_bytes: epubRes.artifacts[0].size_bytes,
      created_at: epubRes.created_at,
      download_url: objectUrl
    };
    setStepState("epub", "completed", "导出成功");
    updateProgress("已完成", "完成", 100);

    await persistWorkspace();

  } catch (error) {
    console.error(error);
    renderError(error instanceof Error ? error.message : "流水线执行失败");
    updateProgress("失败", "遇到错误", 0);
    // Find the first non-completed step and mark it error
    ["notes", "outline", "draft", "epub"].find(step => {
      const el = elements.steps[step];
      if (el && !el.classList.contains("completed")) {
        setStepState(step, "error");
        return true;
      }
      return false;
    });
  } finally {
    isPipelineRunning = false;
  }
}

// -----------------------------------------------------------------------------
// Settings & Workspace Storage
// -----------------------------------------------------------------------------
function getStorageArea() {
  if (!globalThis.chrome?.storage?.local) throw new Error("此页面必须运行在 Chrome 扩展环境里。");
  return chrome.storage.local;
}

async function getSettings() {
  const stored = await getStorageArea().get([SETTINGS_KEY]);
  return stored[SETTINGS_KEY] || { ...DEFAULT_LLM_SETTINGS };
}

async function loadSettings() {
  const settings = await getSettings();
  elements.llmBaseUrl.value = settings.llmBaseUrl || DEFAULT_LLM_SETTINGS.llmBaseUrl;
  elements.llmApiKey.value = settings.llmApiKey || "";
  elements.llmModel.value = settings.llmModel || DEFAULT_LLM_SETTINGS.llmModel;
}

async function saveSettings() {
  const settings = {
    llmBaseUrl: String(elements.llmBaseUrl.value || DEFAULT_LLM_SETTINGS.llmBaseUrl).trim().replace(/\/$/, ""),
    llmApiKey: String(elements.llmApiKey.value || "").trim(),
    llmModel: String(elements.llmModel.value || DEFAULT_LLM_SETTINGS.llmModel).trim() || DEFAULT_LLM_SETTINGS.llmModel,
  };
  await getStorageArea().set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function persistWorkspace() {
  const snapshot = {
    title: elements.title.value,
    language: elements.language.value,
    episodeUrl: elements.episodeUrl.value,
    transcriptText: elements.transcriptText.value,
    workingNotes: latestWorkingNotes,
    bookletOutline: latestBookletOutline,
    bookletDraft: latestBookletDraft,
    stages: latestStages,
    artifactSummary: latestArtifactSummary,
    savedAt: new Date().toISOString(),
  };
  await getStorageArea().set({ [WORKSPACE_KEY]: snapshot });
}

function scheduleWorkspaceSave() {
  if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(() => persistWorkspace().catch(console.error), 500);
}

async function loadWorkspace() {
  const stored = await getStorageArea().get([WORKSPACE_KEY]);
  const ws = stored[WORKSPACE_KEY] || null;
  if (!ws) return;

  elements.title.value = ws.title || "";
  elements.language.value = ws.language || "zh-CN";
  elements.episodeUrl.value = ws.episodeUrl || "";
  elements.transcriptText.value = ws.transcriptText || "";

  renderInspector(ws.stages || []);
  if (ws.workingNotes) renderWorkingNotes(ws.workingNotes);
  if (ws.bookletOutline) renderBookletOutline(ws.bookletOutline);
  if (ws.bookletDraft) renderBookletDraft(ws.bookletDraft);
  
  if (ws.artifactSummary) {
    latestArtifactSummary = ws.artifactSummary;
    // We can't fully restore the Blob URL easily across sessions, but we show the flow as completed.
    switchView("pipeline");
    updateProgress("已完成", "完成", 100);
    setStepState("notes", "completed");
    setStepState("outline", "completed");
    setStepState("draft", "completed");
    setStepState("epub", "completed", "上一次已导出 (点击返回修改重新生成)");
    if (latestArtifactSummary.download_url) {
        renderArtifacts({artifacts: [latestArtifactSummary]});
    }
  }
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
function showSettingsFeedback(message, isError = false) {
  elements.settingsFeedback.textContent = message;
  elements.settingsFeedback.style.color = isError ? "var(--error)" : "var(--muted)";
}

async function init() {
  elements.transcriptText.maxLength = LLM_INPUT_MAX_CHARS;
  
  // Events
  elements.form.addEventListener("submit", handleGeneratePipeline);
  
  elements.resetPipeline.addEventListener("click", () => {
    if (isPipelineRunning) return;
    switchView("input");
  });
  
  // Modal toggles
  elements.openSettingsBtn.addEventListener("click", () => openModal("modal-settings"));
  elements.btns.viewNotes.addEventListener("click", () => openModal("modal-notes"));
  elements.btns.viewOutline.addEventListener("click", () => openModal("modal-outline"));
  elements.btns.viewDraft.addEventListener("click", () => openModal("modal-draft"));
  
  elements.closeModalBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if(target) document.getElementById(target).classList.remove("open");
      elements.modalOverlay.classList.add("hidden");
    });
  });
  elements.modalOverlay.addEventListener("click", closeAllModals);
  
  // Settings
  elements.saveSettings.addEventListener("click", async () => {
    try {
      elements.saveSettings.disabled = true;
      elements.saveSettings.textContent = "保存中...";
      await saveSettings();
      showSettingsFeedback("模型设置已保存！");
      setTimeout(closeAllModals, 1000);
    } catch (error) {
      showSettingsFeedback(error instanceof Error ? `保存失败：${error.message}` : "保存失败。", true);
    } finally {
      elements.saveSettings.disabled = false;
      elements.saveSettings.textContent = "保存设置";
    }
  });
  
  // Sample Data
  elements.loadSample.addEventListener("click", () => {
    elements.title.value = "示例播客：从信息输入到可执行输出";
    elements.episodeUrl.value = "https://example.com/episodes/sample";
    elements.transcriptText.value =
      "主持人：今天我们讨论如何把播客内容沉淀成可复用知识资产。\n嘉宾：先明确问题边界，再拆分结构，最后形成行动清单。\n主持人：如果听众只记住一件事，那就是把输入转成可执行输出。";
    scheduleWorkspaceSave();
  });
  
  // Watch inputs
  [elements.title, elements.language, elements.episodeUrl, elements.transcriptText].forEach(el => {
    el.addEventListener("input", scheduleWorkspaceSave);
  });

  // Startup Loads
  await loadSettings();
  await loadWorkspace();
}

void init().catch(console.error);
