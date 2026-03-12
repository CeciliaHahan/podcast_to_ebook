import {
  DEFAULT_LLM_SETTINGS,
  LLM_INPUT_MAX_CHARS,
  createBookletDraftFromOutline,
  createBookletOutlineFromWorkingNotes,
  createWorkingNotesFromTranscript,
  normalizeWorkingNotes,
} from "./local-pipeline.js";
import { DEFAULT_PROMPTS } from "./prompts.js";
import { createEpubFromBookletDraft } from "./local-epub.js";

const SETTINGS_KEY = "pte_settings_v2";
const WORKSPACE_KEY = "pte_workspace_v1";
const HISTORY_KEY = "pte_history_v1";
const HISTORY_MAX_ENTRIES = 100;
const REASONING_EFFORT_VALUES = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

const elements = {
  // Views
  viewInput: document.getElementById("view-input"),
  viewPipeline: document.getElementById("view-pipeline"),
  
  // Forms & Settings
  llmBaseUrl: document.getElementById("llm-base-url"),
  llmApiKey: document.getElementById("llm-api-key"),
  llmModel: document.getElementById("llm-model"),
  llmTemperature: document.getElementById("llm-temperature"),
  llmReasoningEffort: document.getElementById("llm-reasoning-effort"),
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
  
  // History
  openHistoryBtn: document.getElementById("open-history"),
  historyEmpty: document.getElementById("history-empty"),
  historyList: document.getElementById("history-list"),
  
  // Prompt Editor Elements
  openPromptsBtn: document.getElementById("open-prompts"),
  savePrompts: document.getElementById("save-prompts"),
  resetPrompts: document.getElementById("reset-prompts"),
  promptsFeedback: document.getElementById("prompts-feedback"),
  prompts: {
    wnSystem: document.getElementById("prompt-wn-system"),
    wnUser: document.getElementById("prompt-wn-user"),
    outlineSystem: document.getElementById("prompt-outline-system"),
    outlineUser: document.getElementById("prompt-outline-user"),
    draftSystem: document.getElementById("prompt-draft-system"),
    draftUser: document.getElementById("prompt-draft-user"),
  },

  // Process Modal
  processModalTitle: document.getElementById("process-modal-title"),
  processContent: document.getElementById("process-content"),
  processBtns: {
    notes: document.getElementById("btn-process-notes"),
    outline: document.getElementById("btn-process-outline"),
    draft: document.getElementById("btn-process-draft"),
    epub: document.getElementById("btn-process-epub"),
  },

  // Modal Triggers
  modalOverlay: document.getElementById("modal-overlay"),
  openSettingsBtn: document.getElementById("open-settings"),
  closeModalBtns: document.querySelectorAll(".close-modal")
};

let latestWorkingNotes = null;
let latestBookletOutline = null;
let latestBookletDraft = null;
let latestStepStages = { notes: [], outline: [], draft: [], epub: [] };
let latestArtifactSummary = null;
let generatedArtifactUrls = [];
let workspaceSaveTimer = null;
let isPipelineRunning = false;

const STEP_TITLES = {
  notes: "Working Notes 生成过程",
  outline: "Booklet Outline 生成过程",
  draft: "Booklet Draft 生成过程",
  epub: "EPUB 导出过程",
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

function normalizeReasoningEffort(value) {
  const normalized = String(value || DEFAULT_LLM_SETTINGS.reasoningEffort).trim().toLowerCase();
  return REASONING_EFFORT_VALUES.has(normalized) ? normalized : DEFAULT_LLM_SETTINGS.reasoningEffort;
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
  const viewBtnMap = { notes: "viewNotes", outline: "viewOutline", draft: "viewDraft" };
  const viewBtnKey = viewBtnMap[stepKey];
  const processBtn = elements.processBtns[stepKey];

  if (state === "active") {
    statusEl.innerHTML = `<span class="spinner"></span>${statusText || "处理中..."}`;
  } else if (state === "completed") {
    statusEl.textContent = statusText || "完成";
    if (viewBtnKey) elements.btns[viewBtnKey].hidden = false;
    if (processBtn && latestStepStages[stepKey]?.length) processBtn.hidden = false;
  } else if (state === "error") {
    statusEl.textContent = statusText || "失败";
    if (processBtn && latestStepStages[stepKey]?.length) processBtn.hidden = false;
  } else {
    statusEl.textContent = statusText || "等待中";
    if (viewBtnKey) elements.btns[viewBtnKey].hidden = true;
    if (processBtn) processBtn.hidden = true;
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

// -----------------------------------------------------------------------------
// Process View (per-step structured cards)
// -----------------------------------------------------------------------------

function renderProcessView(stepKey) {
  const stages = latestStepStages[stepKey] || [];
  elements.processModalTitle.textContent = STEP_TITLES[stepKey] || "生成过程";
  elements.processContent.innerHTML = "";

  if (!stages.length) {
    elements.processContent.innerHTML = '<div class="empty-state">暂无过程数据</div>';
    return;
  }

  const inputStage = stages.find(s => s.stage === "transcript" || s.stage === "normalization");
  const requestStage = stages.find(s => s.stage === "llm_request");
  const responseStage = stages.find(s => s.stage === "llm_response");
  const epubStage = stages.find(s => s.stage === "epub");

  // Duration card
  if (stages.length >= 2) {
    const first = new Date(stages[0].ts);
    const last = new Date(stages[stages.length - 1].ts);
    const durationSec = ((last - first) / 1000).toFixed(1);
    elements.processContent.appendChild(buildProcessCard("耗时", [
      ["用时", `${durationSec} 秒`],
      ["开始", new Date(stages[0].ts).toLocaleTimeString()],
    ]));
  }

  // Input summary card
  if (inputStage?.input) {
    const inp = inputStage.input;
    const fields = [];
    if (inp.transcript_chars) fields.push(["转录文本长度", `${inp.transcript_chars.toLocaleString()} 字符`]);
    if (inp.source_type) fields.push(["输入类型", inp.source_type]);
    if (inp.section_count != null) fields.push(["章节数", String(inp.section_count)]);
    if (inp.summary_count != null) fields.push(["摘要条数", String(inp.summary_count)]);
    if (inp.outline_section_count != null) fields.push(["大纲章节数", String(inp.outline_section_count)]);
    if (inp.notes_section_count != null) fields.push(["笔记章节数", String(inp.notes_section_count)]);
    if (fields.length) elements.processContent.appendChild(buildProcessCard("输入概况", fields));
  }

  // Model config card
  if (requestStage?.config || inputStage?.config) {
    const cfg = requestStage?.config || inputStage?.config;
    const fields = [];
    if (cfg.model) fields.push(["模型", cfg.model]);
    if (cfg.temperature != null) fields.push(["温度", String(cfg.temperature)]);
    if (cfg.response_format) fields.push(["输出格式", cfg.response_format]);
    if (cfg.reasoning?.effort) fields.push(["推理强度", cfg.reasoning.effort]);
    if (cfg.endpoint) fields.push(["接口", cfg.endpoint.replace(/^https?:\/\//, "")]);
    if (cfg.flow) fields.push(["流程", cfg.flow]);
    if (fields.length) elements.processContent.appendChild(buildProcessCard("模型配置", fields));
  }

  // Result card
  if (responseStage?.output) {
    const out = responseStage.output;
    const fields = [];
    if (out.http_status != null) fields.push(["HTTP 状态", String(out.http_status), out.http_status === 200 ? "success" : "error"]);
    if (out.parse_ok != null) fields.push(["解析结果", out.parse_ok ? "成功" : "失败", out.parse_ok ? "success" : "error"]);
    if (fields.length) elements.processContent.appendChild(buildProcessCard("处理结果", fields));
  }

  // EPUB-specific result
  if (epubStage?.output) {
    const out = epubStage.output;
    const fields = [];
    if (out.file_name) fields.push(["文件名", out.file_name]);
    if (out.size_bytes) fields.push(["文件大小", `${(out.size_bytes / 1024).toFixed(1)} KB`]);
    if (out.checksum_sha256) fields.push(["校验值", out.checksum_sha256.slice(0, 16) + "..."]);
    if (fields.length) elements.processContent.appendChild(buildProcessCard("导出结果", fields));
  }

  // Prompt text (collapsible, full content)
  if (requestStage?.input?.prompt_preview) {
    elements.processContent.appendChild(
      buildCollapsibleText("发送给模型的提示词", requestStage.input.prompt_preview)
    );
  }

  // Response text (collapsible, full content)
  if (responseStage?.output?.raw_content_preview) {
    elements.processContent.appendChild(
      buildCollapsibleText("模型返回的内容", responseStage.output.raw_content_preview)
    );
  }

  // Input previews
  if (inputStage?.input?.transcript_preview) {
    elements.processContent.appendChild(
      buildCollapsibleText("输入的转录文本（预览）", inputStage.input.transcript_preview)
    );
  }
  if (inputStage?.input?.working_notes_preview) {
    elements.processContent.appendChild(
      buildCollapsibleText("输入的 Working Notes", inputStage.input.working_notes_preview)
    );
  }
  if (inputStage?.input?.outline_preview) {
    elements.processContent.appendChild(
      buildCollapsibleText("输入的 Outline", inputStage.input.outline_preview)
    );
  }
}

function buildProcessCard(label, fields) {
  const card = document.createElement("div");
  card.className = "process-card";
  const labelEl = document.createElement("div");
  labelEl.className = "process-card-label";
  labelEl.textContent = label;
  card.appendChild(labelEl);
  for (const [key, value, cls] of fields) {
    const row = document.createElement("div");
    row.className = "process-field";
    const k = document.createElement("span");
    k.className = "process-field-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = "process-field-value" + (cls ? ` ${cls}` : "");
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    card.appendChild(row);
  }
  return card;
}

function buildCollapsibleText(label, text) {
  const block = document.createElement("div");
  block.className = "process-text-block";
  const labelEl = document.createElement("div");
  labelEl.className = "process-text-label";
  labelEl.textContent = label;
  const body = document.createElement("div");
  body.className = "process-text-body";
  body.textContent = text;
  labelEl.addEventListener("click", () => {
    labelEl.classList.toggle("open");
    body.classList.toggle("open");
  });
  block.appendChild(labelEl);
  block.appendChild(body);
  return block;
}

function renderWorkingNotes(notes) {
  const normalizedNotes = normalizeWorkingNotes(notes, notes?.title || elements.title.value.trim());
  latestWorkingNotes = normalizedNotes;
  elements.workingNotesSummary.innerHTML = "";
  elements.workingNotesSections.innerHTML = "";
  if (!normalizedNotes?.summary?.length || !normalizedNotes?.sections?.length) {
    elements.workingNotesEmpty.hidden = false;
    elements.workingNotesPanel.hidden = true;
    return;
  }
  for (const item of normalizedNotes.summary) {
    const li = document.createElement("li");
    li.textContent = item;
    elements.workingNotesSummary.appendChild(li);
  }
  for (const section of normalizedNotes.sections) {
    const article = document.createElement("article");
    article.className = "working-note-section";
    const title = document.createElement("h4");
    title.textContent = section.heading;
    article.appendChild(title);
    if (section.gist) {
      const gist = document.createElement("p");
      gist.className = "working-note-gist";
      gist.textContent = section.gist;
      article.appendChild(gist);
    }

    if (section.claims?.length) {
      const claimsLabel = document.createElement("div");
      claimsLabel.className = "working-note-subtitle";
      claimsLabel.textContent = "主要观点";
      article.appendChild(claimsLabel);

      const claims = document.createElement("ul");
      for (const claim of section.claims || []) {
        const li = document.createElement("li");
        li.textContent = claim;
        claims.appendChild(li);
      }
      article.appendChild(claims);
    }

    if (section.evidence?.length) {
      const evidenceLabel = document.createElement("div");
      evidenceLabel.className = "working-note-subtitle";
      evidenceLabel.textContent = "主要论据与例子";
      article.appendChild(evidenceLabel);

      const evidence = document.createElement("div");
      evidence.className = "working-note-excerpts";
      for (const item of section.evidence || []) {
        const block = document.createElement("blockquote");
        block.className = "working-note-excerpt";
        block.textContent = item.speaker ? `${item.speaker}：${item.text}` : item.text;
        evidence.appendChild(block);
      }
      article.appendChild(evidence);
    }

    if (section.sparks?.length) {
      const sparksLabel = document.createElement("div");
      sparksLabel.className = "working-note-subtitle";
      sparksLabel.textContent = "对话火花";
      article.appendChild(sparksLabel);

      const sparks = document.createElement("div");
      sparks.className = "working-note-excerpts";
      for (const item of section.sparks || []) {
        const block = document.createElement("blockquote");
        block.className = "working-note-excerpt working-note-spark";
        block.textContent = item.speaker ? `${item.speaker}：${item.text}` : item.text;
        sparks.appendChild(block);
      }
      article.appendChild(sparks);
    }

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

    if (section.intro) {
      const introLabel = document.createElement("div");
      introLabel.className = "draft-section-label";
      introLabel.textContent = "这一部分在讲什么";
      article.appendChild(introLabel);

      const intro = document.createElement("p");
      intro.className = "draft-section-intro";
      intro.textContent = section.intro;
      article.appendChild(intro);
    }

    if (section.claims?.length) {
      const claimsLabel = document.createElement("div");
      claimsLabel.className = "draft-section-label";
      claimsLabel.textContent = "主要观点";
      article.appendChild(claimsLabel);

      const claims = document.createElement("ul");
      claims.className = "draft-section-list";
      for (const claim of section.claims) {
        const li = document.createElement("li");
        li.textContent = claim;
        claims.appendChild(li);
      }
      article.appendChild(claims);
    }

    if (section.evidence?.length) {
      article.appendChild(buildDraftSpeakerTextBlock("主要论据与例子", section.evidence, "draft-evidence"));
    }

    if (section.quotes?.length) {
      article.appendChild(buildDraftSpeakerTextBlock("原话摘录", section.quotes, "draft-quote"));
    }

    if (section.dialogue?.length) {
      article.appendChild(buildDraftSpeakerTextBlock("关键对话", section.dialogue, "draft-dialogue"));
    }

    if (!section.intro && !section.claims?.length && !section.evidence?.length && !section.quotes?.length && !section.dialogue?.length) {
      const paragraphs = String(section.body || "")
        .split(/\n{2,}/).map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean);
      for (const paragraph of paragraphs) {
        const p = document.createElement("p");
        p.textContent = paragraph;
        article.appendChild(p);
      }
    }
    elements.bookletDraftSections.appendChild(article);
  }
  elements.bookletDraftEmpty.hidden = true;
  elements.bookletDraftPanel.hidden = false;
}

function buildDraftSpeakerTextBlock(labelText, entries, toneClass) {
  const wrapper = document.createElement("div");

  const label = document.createElement("div");
  label.className = "draft-section-label";
  label.textContent = labelText;
  wrapper.appendChild(label);

  const list = document.createElement("div");
  list.className = "draft-entries";
  for (const entry of entries) {
    const block = document.createElement("blockquote");
    block.className = `draft-entry ${toneClass}`;
    block.textContent = entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text;
    list.appendChild(block);
  }
  wrapper.appendChild(list);
  return wrapper;
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

async function saveToHistory() {
  const title = elements.title.value.trim();
  if (!title || !latestBookletDraft) return;

  const entry = {
    id: crypto.randomUUID(),
    title,
    language: elements.language.value,
    episodeUrl: elements.episodeUrl.value,
    createdAt: new Date().toISOString(),
    pinned: false,
    sectionCount: latestBookletDraft?.sections?.length || 0,
    transcriptPreview: (elements.transcriptText.value || "").slice(0, 200),
    workingNotes: latestWorkingNotes,
    bookletOutline: latestBookletOutline,
    bookletDraft: latestBookletDraft,
    stepStages: latestStepStages,
    artifactSummary: latestArtifactSummary
      ? { file_name: latestArtifactSummary.file_name, size_bytes: latestArtifactSummary.size_bytes, created_at: latestArtifactSummary.created_at }
      : null,
  };

  const stored = await getStorageArea().get([HISTORY_KEY]);
  const history = stored[HISTORY_KEY] || [];
  history.unshift(entry);

  // Cap at HISTORY_MAX_ENTRIES — drop oldest unpinned first
  while (history.length > HISTORY_MAX_ENTRIES) {
    const lastUnpinnedIdx = history.findLastIndex(e => !e.pinned);
    if (lastUnpinnedIdx === -1) break; // all pinned, can't trim further
    history.splice(lastUnpinnedIdx, 1);
  }

  await getStorageArea().set({ [HISTORY_KEY]: history });
}

async function renderHistoryList() {
  const stored = await getStorageArea().get([HISTORY_KEY]);
  const history = stored[HISTORY_KEY] || [];

  elements.historyList.innerHTML = "";
  if (!history.length) {
    elements.historyEmpty.hidden = false;
    return;
  }
  elements.historyEmpty.hidden = true;

  // Sort: pinned first, then by date desc
  const sorted = [...history].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const pinned = sorted.filter(e => e.pinned);
  const unpinned = sorted.filter(e => !e.pinned);

  if (pinned.length) {
    const div = document.createElement("div");
    div.className = "history-divider";
    div.textContent = "已收藏";
    elements.historyList.appendChild(div);
    for (const entry of pinned) elements.historyList.appendChild(buildHistoryCard(entry));
  }
  if (unpinned.length) {
    const div = document.createElement("div");
    div.className = "history-divider";
    div.textContent = pinned.length ? "全部" : "历史记录";
    elements.historyList.appendChild(div);
    for (const entry of unpinned) elements.historyList.appendChild(buildHistoryCard(entry));
  }
}

function buildHistoryCard(entry) {
  const card = document.createElement("div");
  card.className = `history-card${entry.pinned ? " pinned" : ""}`;

  const body = document.createElement("div");
  body.style.overflow = "hidden";
  body.addEventListener("click", () => loadFromHistory(entry));

  const title = document.createElement("div");
  title.className = "history-card-title";
  title.textContent = entry.title;
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "history-card-meta";
  const date = new Date(entry.createdAt);
  meta.textContent = `${date.toLocaleDateString()} · ${entry.sectionCount} 节`;
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "history-card-actions";

  const pinBtn = document.createElement("button");
  pinBtn.textContent = entry.pinned ? "★" : "☆";
  pinBtn.title = entry.pinned ? "取消收藏" : "收藏";
  pinBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleHistoryPin(entry.id); });

  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑";
  delBtn.title = "删除";
  delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteHistoryEntry(entry.id); });

  actions.appendChild(pinBtn);
  actions.appendChild(delBtn);

  card.appendChild(body);
  card.appendChild(actions);
  return card;
}

async function toggleHistoryPin(id) {
  const stored = await getStorageArea().get([HISTORY_KEY]);
  const history = stored[HISTORY_KEY] || [];
  const entry = history.find(e => e.id === id);
  if (entry) entry.pinned = !entry.pinned;
  await getStorageArea().set({ [HISTORY_KEY]: history });
  await renderHistoryList();
}

async function deleteHistoryEntry(id) {
  if (!confirm("确定删除这条历史记录？")) return;
  const stored = await getStorageArea().get([HISTORY_KEY]);
  const history = (stored[HISTORY_KEY] || []).filter(e => e.id !== id);
  await getStorageArea().set({ [HISTORY_KEY]: history });
  await renderHistoryList();
}

function loadFromHistory(entry) {
  closeAllModals();

  // Populate form fields
  elements.title.value = entry.title || "";
  elements.language.value = entry.language || "zh-CN";
  elements.episodeUrl.value = entry.episodeUrl || "";
  elements.transcriptText.value = entry.transcriptPreview || "";

  // Restore state
  if (entry.stepStages) latestStepStages = entry.stepStages;
  if (entry.workingNotes) renderWorkingNotes(entry.workingNotes);
  if (entry.bookletOutline) renderBookletOutline(entry.bookletOutline);
  if (entry.bookletDraft) renderBookletDraft(entry.bookletDraft);

  // Show pipeline view with all steps completed
  switchView("pipeline");
  updateProgress("已完成", "完成", 100);
  setStepState("notes", "completed");
  setStepState("outline", "completed");
  setStepState("draft", "completed");
  setStepState("epub", "completed", "从历史记录还原");

  // Restore artifact summary (no blob URL available)
  latestArtifactSummary = entry.artifactSummary || null;
  elements.epubContainer.innerHTML = "";
  if (latestArtifactSummary) {
    const span = document.createElement("span");
    span.style.fontSize = "12px";
    span.style.color = "var(--muted)";
    span.textContent = `${latestArtifactSummary.file_name} (历史记录，需重新生成下载)`;
    elements.epubContainer.appendChild(span);
  }

  // Persist as current workspace
  persistWorkspace().catch(console.error);
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
  latestStepStages = { notes: [], outline: [], draft: [], epub: [] };
}

async function handleGeneratePipeline(event) {
  event.preventDefault();
  if (isPipelineRunning) return;
  isPipelineRunning = true;
  
  resetPipelineUI();
  switchView("pipeline");
  
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
    latestStepStages.notes = notesRes.stages || [];
    renderWorkingNotes(notesRes.working_notes);
    setStepState("notes", "completed");
    updateProgress("处理中", "Working Notes 完成", 25);
    
    // STEP 2: Booklet Outline
    setStepState("outline", "active", "整理章节结构中...");
    updateProgress("处理中", "模型请求 (2/3)", 35);
    const outlineRes = await createBookletOutlineFromWorkingNotes({
      settings, title: resolvedTitle, language, workingNotes: latestWorkingNotes, metadata: { episode_url: episodeUrl }
    });
    latestStepStages.outline = outlineRes.stages || [];
    renderBookletOutline(outlineRes.booklet_outline);
    setStepState("outline", "completed");
    updateProgress("处理中", "Outline 完成", 50);

    // STEP 3: Booklet Draft
    setStepState("draft", "active", "撰写正文中 (约需2-3分钟)...");
    updateProgress("处理中", "模型请求 (3/3)", 60);
    const draftRes = await createBookletDraftFromOutline({
      settings, title: resolvedTitle, language, workingNotes: latestWorkingNotes, bookletOutline: latestBookletOutline, metadata: { episode_url: episodeUrl }
    });
    latestStepStages.draft = draftRes.stages || [];
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
    latestStepStages.epub = epubRes.stages || [];
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
    await saveToHistory();

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
  const saved = stored[SETTINGS_KEY] || {};
  return {
    ...DEFAULT_LLM_SETTINGS,
    ...saved,
    reasoningEffort: normalizeReasoningEffort(saved.reasoningEffort),
    prompts: {
      ...DEFAULT_PROMPTS,
      ...(saved.prompts || {}),
    },
  };
}

async function loadSettings() {
  const settings = await getSettings();
  elements.llmBaseUrl.value = settings.llmBaseUrl || DEFAULT_LLM_SETTINGS.llmBaseUrl;
  elements.llmApiKey.value = settings.llmApiKey || DEFAULT_LLM_SETTINGS.llmApiKey || "";
  elements.llmModel.value = settings.llmModel || DEFAULT_LLM_SETTINGS.llmModel;
  if (settings.temperature !== undefined) {
    elements.llmTemperature.value = settings.temperature;
  }
  elements.llmReasoningEffort.value = normalizeReasoningEffort(settings.reasoningEffort);
  
  elements.prompts.wnSystem.value = settings.prompts.wnSystem;
  elements.prompts.wnUser.value = settings.prompts.wnUser;
  elements.prompts.outlineSystem.value = settings.prompts.outlineSystem;
  elements.prompts.outlineUser.value = settings.prompts.outlineUser;
  elements.prompts.draftSystem.value = settings.prompts.draftSystem;
  elements.prompts.draftUser.value = settings.prompts.draftUser;
}

async function saveSettings() {
  const settings = {
    llmBaseUrl: String(elements.llmBaseUrl.value || DEFAULT_LLM_SETTINGS.llmBaseUrl).trim().replace(/\/$/, ""),
    llmApiKey: String(elements.llmApiKey.value || "").trim(),
    llmModel: String(elements.llmModel.value || DEFAULT_LLM_SETTINGS.llmModel).trim() || DEFAULT_LLM_SETTINGS.llmModel,
    temperature: elements.llmTemperature.value ? Number(elements.llmTemperature.value) : undefined,
    reasoningEffort: normalizeReasoningEffort(elements.llmReasoningEffort.value),
    prompts: {
      wnSystem: elements.prompts.wnSystem.value,
      wnUser: elements.prompts.wnUser.value,
      outlineSystem: elements.prompts.outlineSystem.value,
      outlineUser: elements.prompts.outlineUser.value,
      draftSystem: elements.prompts.draftSystem.value,
      draftUser: elements.prompts.draftUser.value,
    }
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
    stepStages: latestStepStages,
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

  if (ws.stepStages) latestStepStages = ws.stepStages;
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
  elements.openHistoryBtn.addEventListener("click", () => { openModal("modal-history"); renderHistoryList(); });
  elements.openSettingsBtn.addEventListener("click", () => openModal("modal-settings"));
  elements.btns.viewNotes.addEventListener("click", () => openModal("modal-notes"));
  elements.btns.viewOutline.addEventListener("click", () => openModal("modal-outline"));
  elements.btns.viewDraft.addEventListener("click", () => openModal("modal-draft"));

  for (const [stepKey, btn] of Object.entries(elements.processBtns)) {
    btn.addEventListener("click", () => { renderProcessView(stepKey); openModal("modal-process"); });
  }

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

  // Prompts
  elements.openPromptsBtn.addEventListener("click", () => openModal("modal-prompts"));

  elements.savePrompts.addEventListener("click", async () => {
    try {
      elements.savePrompts.disabled = true;
      elements.savePrompts.textContent = "保存中...";
      await saveSettings();
      elements.promptsFeedback.textContent = "提示词已保存！";
      elements.promptsFeedback.style.color = "var(--success)";
      setTimeout(() => { elements.promptsFeedback.textContent = ""; }, 2000);
    } catch (error) {
      elements.promptsFeedback.textContent = "保存失败";
      elements.promptsFeedback.style.color = "var(--error)";
    } finally {
      elements.savePrompts.disabled = false;
      elements.savePrompts.textContent = "保存提示词";
    }
  });

  elements.resetPrompts.addEventListener("click", () => {
    if (!confirm("确定要恢复默认提示词吗？当前修改将会丢失。")) return;
    elements.prompts.wnSystem.value = DEFAULT_PROMPTS.wnSystem;
    elements.prompts.wnUser.value = DEFAULT_PROMPTS.wnUser;
    elements.prompts.outlineSystem.value = DEFAULT_PROMPTS.outlineSystem;
    elements.prompts.outlineUser.value = DEFAULT_PROMPTS.outlineUser;
    elements.prompts.draftSystem.value = DEFAULT_PROMPTS.draftSystem;
    elements.prompts.draftUser.value = DEFAULT_PROMPTS.draftUser;
    elements.promptsFeedback.textContent = "已恢复默认，请点击保存。";
    elements.promptsFeedback.style.color = "var(--muted)";
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
