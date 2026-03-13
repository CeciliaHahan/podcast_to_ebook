import { DEFAULT_PROMPTS, buildPrompt } from "./prompts.js";

// Try to load a gitignored config file with a pre-set API key.
// If config.local.js doesn't exist, fall back to empty (user enters key manually).
let _localApiKey = "";
try {
  const localConfig = await import("./config.local.js");
  _localApiKey = localConfig.LOCAL_API_KEY || "";
} catch {
  // config.local.js not present — that's fine, user sets key in settings.
}

export const DEFAULT_LLM_SETTINGS = {
  llmBaseUrl: "https://openrouter.ai/api/v1",
  llmModel: "google/gemini-3-flash-preview",
  llmApiKey: _localApiKey,
  reasoningEffort: "medium",
};

export const LLM_INPUT_MAX_CHARS = 80_000;
const LLM_TIMEOUT_MS = 90_000;
const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://chrome-extension.local/podcasts-to-ebooks",
  "X-Title": "Podcasts to Ebooks",
};
const SUPPORTED_LLM_HOSTS = new Set(["openrouter.ai", "api.openai.com"]);
const OPENROUTER_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

function createLocalId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function extractFirstJsonObject(input) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return input.slice(start, index + 1);
      }
    }
  }
  return null;
}

function cleanLine(input, maxLength = 180) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBodyText(input, maxLength = 4_000) {
  if (typeof input !== "string") {
    return "";
  }
  const text = input
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return text.slice(0, maxLength);
}

function cleanParagraph(input, maxLength = 800) {
  return cleanBodyText(input, maxLength);
}

function normalizeSpeakerLabel(input) {
  return cleanLine(input, 40).toLowerCase().replace(/\s+/g, "");
}

function isLikelySpeakerName(input) {
  const candidate = cleanLine(input, 24);
  if (!candidate) {
    return false;
  }
  if (/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(candidate)) {
    return true;
  }
  if (!/^[\u4e00-\u9fa5·]{1,8}$/.test(candidate)) {
    return false;
  }
  return candidate.length <= 6;
}

function parseTranscriptTurns(transcriptText) {
  const lines = String(transcriptText || "").split(/\r?\n/);
  const turns = [];
  let current = null;
  const headerPattern = /^(发言人\s*\d+|speaker\s*\d+|主持人|嘉宾)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(headerPattern);
    if (match) {
      if (current?.text) {
        turns.push(current);
      }
      current = {
        label: cleanLine(match[1], 40),
        timestamp: match[2],
        text: "",
      };
      continue;
    }
    if (!current) {
      continue;
    }
    current.text = current.text ? `${current.text} ${line}` : line;
  }
  if (current?.text) {
    turns.push(current);
  }
  return turns;
}

function extractSelfIntroName(text) {
  const opening = String(text || "").slice(0, 80).trim();
  const patterns = [
    /^(?:(?:hello|hi)[，,\s]*)?(?:大家好[，,\s]*)?我(?:是|叫)\s*([A-Za-z\u4e00-\u9fa5·]{1,16})/i,
    /(?:^|[，,。！？.!?])\s*我(?:是|叫)\s*([A-Za-z\u4e00-\u9fa5·]{1,16})/i,
    /^(?:大家好[，,\s]*)?我\s*([A-Za-z][A-Za-z0-9_-]{1,15}|[\u4e00-\u9fa5·]{1,12})(?=[，,。！？.!?]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = opening.match(pattern);
    if (match && isLikelySpeakerName(match[1])) {
      return cleanLine(match[1], 24);
    }
  }
  return "";
}

function buildSpeakerMapFromTranscript(transcriptText) {
  const turns = parseTranscriptTurns(transcriptText);
  const resolved = new Map();
  for (const turn of turns.slice(0, 14)) {
    const normalizedLabel = normalizeSpeakerLabel(turn.label);
    if (!normalizedLabel || resolved.has(normalizedLabel)) {
      continue;
    }
    const introName = extractSelfIntroName(turn.text);
    if (introName) {
      resolved.set(normalizedLabel, introName);
    }
  }
  return resolved;
}

function buildSpeakerHintsText(transcriptText) {
  const speakerMap = buildSpeakerMapFromTranscript(transcriptText);
  if (!speakerMap.size) {
    return "未从 transcript 中稳定识别出 speaker 名字。若无法判断，请保留原 speaker 标签。";
  }
  return [
    "以下是从 transcript 初步识别的 speaker hints：",
    ...[...speakerMap.entries()].map(([label, name]) => `- ${label} -> ${name}`),
  ].join("\n");
}

export function previewSpeakerMap(transcriptText) {
  return Object.fromEntries(buildSpeakerMapFromTranscript(transcriptText));
}

function replaceInlineSpeakerLabels(text, speakerMap) {
  if (!text || !speakerMap?.size) {
    return text || "";
  }
  let output = String(text);
  for (const [label, name] of speakerMap.entries()) {
    let pattern = null;
    const speakerDigits = label.match(/^speaker(\d+)$/i);
    const narratorDigits = label.match(/^发言人(\d+)$/i);
    if (speakerDigits) {
      pattern = new RegExp(`speaker\\s*${speakerDigits[1]}`, "gi");
    } else if (narratorDigits) {
      pattern = new RegExp(`发言人\\s*${narratorDigits[1]}`, "g");
    }
    if (!pattern) {
      continue;
    }
    output = output.replace(pattern, name);
  }
  return output;
}

function applySpeakerMapToSpeakerTextEntries(entries, speakerMap) {
  return (entries || []).map((entry) => {
    if (typeof entry === "string") {
      return replaceInlineSpeakerLabels(entry, speakerMap);
    }
    const normalized = normalizeSpeakerLabel(entry.speaker);
    const speaker = speakerMap?.get(normalized) || entry.speaker;
    return {
      ...(speaker ? { speaker } : {}),
      text: replaceInlineSpeakerLabels(entry.text, speakerMap),
    };
  });
}

function applySpeakerMapToWorkingNotes(workingNotes, speakerMap) {
  if (!workingNotes || !speakerMap?.size) {
    return workingNotes;
  }
  return {
    ...workingNotes,
    sections: workingNotes.sections.map((section) => ({
      ...section,
      evidence: applySpeakerMapToSpeakerTextEntries(section.evidence, speakerMap),
      dialogue: applySpeakerMapToSpeakerTextEntries(section.dialogue, speakerMap),
      sparks: applySpeakerMapToSpeakerTextEntries(section.sparks, speakerMap),
    })),
  };
}

function applySpeakerMapToDraft(bookletDraft, speakerMap) {
  if (!bookletDraft || !speakerMap?.size) {
    return bookletDraft;
  }
  return {
    ...bookletDraft,
    sections: bookletDraft.sections.map((section) => ({
      ...section,
      evidence: applySpeakerMapToSpeakerTextEntries(section.evidence, speakerMap),
      quotes: applySpeakerMapToSpeakerTextEntries(section.quotes, speakerMap),
      dialogue: applySpeakerMapToSpeakerTextEntries(section.dialogue, speakerMap),
      body: replaceInlineSpeakerLabels(section.body, speakerMap),
    })),
  };
}

function readStringList(input, maxItems, maxItemLength) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const cleaned = cleanLine(item, maxItemLength);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function readSpeakerTextEntry(input, maxTextLength) {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    const cleaned = cleanLine(input, maxTextLength + 42);
    if (!cleaned) {
      return null;
    }
    const match = cleaned.match(/^([^：:\n]{1,24})[：:]\s*(.+)$/);
    if (!match) {
      return { text: cleanLine(cleaned, maxTextLength) };
    }
    const speaker = cleanLine(match[1], 40);
    const text = cleanLine(match[2], maxTextLength);
    if (!text) {
      return null;
    }
    return speaker ? { speaker, text } : { text };
  }
  if (typeof input !== "object") {
    return null;
  }
  const speaker = cleanLine(input.speaker, 40);
  const text = cleanLine(input.text, maxTextLength);
  if (!text) {
    return null;
  }
  return speaker ? { speaker, text } : { text };
}

function readSpeakerTextList(input, maxItems, maxTextLength) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const entry = readSpeakerTextEntry(item, maxTextLength);
    if (!entry) {
      continue;
    }
    const key = `${entry.speaker || ""}::${entry.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(entry);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function countInlineSpeakerMentions(text) {
  const matches = String(text || "").match(/[A-Za-z\u4e00-\u9fa5·]{1,24}[：:]/g);
  return matches ? matches.length : 0;
}

function formatSpeakerTextEntry(entry) {
  if (!entry?.text) {
    return "";
  }
  return entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text;
}

function looksLikeExchangeBlock(entry) {
  if (!entry?.text) {
    return false;
  }
  const mentionCount = countInlineSpeakerMentions(entry.text);
  if (!entry.speaker) {
    return mentionCount >= 2;
  }
  return mentionCount >= 1;
}

function normalizeDialogueEntries(entries, maxItems = 3) {
  if (!entries?.length) {
    return [];
  }
  const normalized = [];

  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    if (!current?.text) {
      continue;
    }

    if (looksLikeExchangeBlock(current)) {
      const text = current.speaker && !current.text.startsWith(`${current.speaker}：`) && !current.text.startsWith(`${current.speaker}:`)
        ? `${current.speaker}：${current.text}`
        : current.text;
      normalized.push({ text: cleanLine(text, 720) });
      continue;
    }

    const next = entries[index + 1];
    const nextSpeaker = normalizeSpeakerLabel(next?.speaker);
    const currentSpeaker = normalizeSpeakerLabel(current.speaker);
    const canMergePair =
      next?.text &&
      currentSpeaker &&
      nextSpeaker &&
      currentSpeaker !== nextSpeaker &&
      !looksLikeExchangeBlock(next);

    if (canMergePair) {
      const merged = `${formatSpeakerTextEntry(current)} ${formatSpeakerTextEntry(next)}`;
      const third = entries[index + 2];
      const thirdSpeaker = normalizeSpeakerLabel(third?.speaker);
      const canMergeThird =
        third?.text &&
        thirdSpeaker &&
        thirdSpeaker !== currentSpeaker &&
        thirdSpeaker !== nextSpeaker &&
        !looksLikeExchangeBlock(third);
      const mergedText = canMergeThird ? `${merged} ${formatSpeakerTextEntry(third)}` : merged;
      normalized.push({ text: cleanLine(mergedText, 720) });
      index += canMergeThird ? 2 : 1;
      continue;
    }

    normalized.push(current.speaker ? { speaker: current.speaker, text: current.text } : { text: current.text });
  }

  return selectStrongDialogueEntries(normalized, maxItems);
}

function extractInlineSpeakerNames(text) {
  const matches = [...String(text || "").matchAll(/([A-Za-z\u4e00-\u9fa5·]{1,24})[：:]/g)];
  const unique = [];
  const seen = new Set();
  for (const match of matches) {
    const speaker = cleanLine(match[1], 24);
    if (!speaker || seen.has(speaker)) {
      continue;
    }
    seen.add(speaker);
    unique.push(speaker);
  }
  return unique;
}

function scoreDialogueEntry(entry) {
  const text = formatSpeakerTextEntry(entry);
  const speakers = extractInlineSpeakerNames(text);
  const turnCount = countInlineSpeakerMentions(text);
  const questionCount = (text.match(/[？?]/g) || []).length;
  const responseCueCount =
    (text.match(/(^|[。！？!?，,\s])(对|对啊|对呀|是的|没错|所以|但是|可是|那也|然后|结果|因为|什么意思|怎么|为什么|凭什么|我觉得|你说|我说)/g) || []).length;
  const humorCueCount = (text.match(/(哈哈|笑|梗|太吓人了|那也不能|不可能吧|这句话咋了)/g) || []).length;
  const contradictionCueCount = (text.match(/(不是|不对|但|但是|可是|凭什么|不可能|我不|我就不|你退一步|谁来解决)/g) || []).length;

  let score = 0;
  score += Math.min(speakers.length, 4) * 4;
  score += Math.min(turnCount, 5) * 2;
  score += questionCount * 3;
  score += responseCueCount * 2;
  score += humorCueCount * 2;
  score += contradictionCueCount * 2;

  if (speakers.length >= 2 && turnCount >= 3) {
    score += 4;
  }
  if (speakers.length >= 3) {
    score += 2;
  }
  if (speakers.length >= 2 && questionCount === 0 && responseCueCount === 0 && contradictionCueCount === 0 && humorCueCount === 0) {
    score -= 4;
  }
  return score;
}

function selectStrongDialogueEntries(entries, maxItems = 3) {
  if (!entries?.length) {
    return [];
  }
  const ranked = entries
    .map((entry, index) => ({ entry, index, score: scoreDialogueEntry(entry) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxItems)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.entry);
  return ranked;
}

function canonicalizeEntryText(input) {
  return String(input || "")
    .replace(/[A-Za-z\u4e00-\u9fa5·]{1,24}[：:]/g, " ")
    .replace(/[“”"'`（）()【】\[\]….,，。！？!?:：；;\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEntryCoveredByReference(entry, references) {
  const candidate = canonicalizeEntryText(formatSpeakerTextEntry(entry));
  if (!candidate || candidate.length < 12) {
    return false;
  }
  return references.some((reference) => {
    const normalizedReference = canonicalizeEntryText(formatSpeakerTextEntry(reference));
    return normalizedReference.includes(candidate) || candidate.includes(normalizedReference);
  });
}

function dedupeDraftEntryBuckets(evidence, quotes, dialogue) {
  const normalizedDialogue = normalizeDialogueEntries(dialogue, 3);
  const filteredQuotes = [];
  for (const entry of quotes || []) {
    if (!isEntryCoveredByReference(entry, normalizedDialogue)) {
      filteredQuotes.push(entry);
    }
  }

  const filteredEvidence = [];
  for (const entry of evidence || []) {
    if (isEntryCoveredByReference(entry, normalizedDialogue) || isEntryCoveredByReference(entry, filteredQuotes)) {
      continue;
    }
    filteredEvidence.push(entry);
  }

  const rebalancedQuotes = rebalanceQuoteEntries(filteredQuotes, filteredEvidence, normalizedDialogue);
  return {
    evidence: rebalanceEvidenceEntries(filteredEvidence, rebalancedQuotes),
    quotes: rebalancedQuotes,
    dialogue: normalizedDialogue,
  };
}

function scoreQuoteEntry(entry) {
  const text = formatSpeakerTextEntry(entry);
  const length = cleanLine(text, 500).length;
  const punctuationCount = (text.match(/[！？?!]/g) || []).length;
  const imageryCueCount = (text.match(/(像|不是|就是|太|真|根本|只要|没办法|凭什么|我不|我就|谁来|海阔天空|悬崖|半扇猪肉|阳气|激情|退一步|没招|不穿鞋|找回|毒药|狠角色|rage baiting|great tits)/gi) || []).length;
  const colloquialCueCount = (text.match(/(我|你|他|她|我们|吧|啊|呀|呢|吗|呗|老子|天哪|真的|太|就)/g) || []).length;
  const explanatoryCueCount = (text.match(/(因为|所以|比如|例如|其实|当时|后来|通过|背后|意味着|说明|逻辑|原因|背景|场景|经历|故事|大会|学校|广告|播客|品牌|股价|大学|同学|朋友|Taylor|Sydney|American|Alex Clark)/gi) || []).length;
  const numberCueCount = (text.match(/\d+/g) || []).length;
  const sentenceCount = String(text).split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean).length;
  let score = 0;
  if (length >= 10 && length <= 80) {
    score += 10;
  } else if (length <= 120) {
    score += 7;
  } else if (length <= 170) {
    score += 2;
  } else {
    score -= 6;
  }
  score += punctuationCount * 2;
  score += imageryCueCount * 2;
  score += Math.min(colloquialCueCount, 6);
  score -= explanatoryCueCount * 2;
  score -= numberCueCount;
  if (countInlineSpeakerMentions(text) >= 2) {
    score -= 5;
  }
  if (sentenceCount >= 3 && imageryCueCount === 0) {
    score -= 5;
  }
  if (length > 130 && imageryCueCount < 2 && punctuationCount === 0) {
    score -= 6;
  }
  return score;
}

function scoreEvidenceEntry(entry) {
  const text = formatSpeakerTextEntry(entry);
  const length = cleanLine(text, 500).length;
  const explanationCueCount = (text.match(/(因为|所以|比如|例如|其实|当时|后来|通过|背后|意味着|说明|逻辑|原因|结果|然后|具体|场景|经历|故事)/g) || []).length;
  const detailCueCount = (text.match(/(\d+|American|Sydney|Taylor|学校|广告|播客|领导|同学|朋友|大会|杂志|牛仔裤|避孕药|密室|专场)/g) || []).length;
  let score = 0;
  if (length >= 40 && length <= 280) {
    score += 5;
  } else if (length > 280) {
    score += 2;
  }
  score += explanationCueCount * 2;
  score += Math.min(detailCueCount, 4);
  if (countInlineSpeakerMentions(text) >= 2) {
    score -= 4;
  }
  return score;
}

function rebalanceQuoteEntries(quotes, evidence, dialogue) {
  const targetCount = Math.min(Math.max((quotes || []).length, 1), 4);
  const candidateMap = new Map();
  for (const entry of [...(quotes || []), ...(evidence || [])]) {
    const key = `${entry.speaker || ""}::${entry.text}`;
    if (!entry?.text || candidateMap.has(key) || isEntryCoveredByReference(entry, dialogue || [])) {
      continue;
    }
    candidateMap.set(key, entry);
  }

  const ranked = [...candidateMap.values()]
    .map((entry) => ({ entry, score: scoreQuoteEntry(entry) }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  for (const item of ranked) {
    const minScore = selected.length === 0 ? 9 : 7;
    if (item.score < minScore) {
      continue;
    }
    selected.push(item.entry);
    if (selected.length >= targetCount) {
      break;
    }
  }

  if (!selected.length && ranked.length) {
    selected.push(ranked[0].entry);
  }

  return dedupeSelectedQuotes(selected).slice(0, 4);
}

function dedupeSelectedQuotes(entries) {
  const ranked = [...(entries || [])]
    .map((entry) => ({ entry, score: scoreQuoteEntry(entry) }))
    .sort((left, right) => right.score - left.score);
  const kept = [];
  for (const item of ranked) {
    if (isEntryCoveredByReference(item.entry, kept)) {
      continue;
    }
    kept.push(item.entry);
  }
  return kept;
}

function rebalanceEvidenceEntries(evidence, quotes) {
  const quoteSet = new Set((quotes || []).map((entry) => `${entry.speaker || ""}::${entry.text}`));
  const filtered = (evidence || []).filter((entry) => !quoteSet.has(`${entry.speaker || ""}::${entry.text}`));
  return filtered
    .sort((left, right) => scoreEvidenceEntry(right) - scoreEvidenceEntry(left))
    .slice(0, 6);
}

function findBestMatchingWorkingNotesSection(draftSection, workingNotesSections, index) {
  const heading = cleanLine(draftSection?.heading, 60);
  if (heading) {
    const exact = (workingNotesSections || []).find((section) => cleanLine(section.heading, 60) === heading);
    if (exact) {
      return exact;
    }
  }
  return (workingNotesSections || [])[index] || null;
}

function enrichDraftQuotesFromWorkingNotes(bookletDraft, workingNotes) {
  if (!bookletDraft?.sections?.length || !workingNotes?.sections?.length) {
    return bookletDraft;
  }
  return {
    ...bookletDraft,
    sections: bookletDraft.sections.map((section, index) => {
      const noteSection = findBestMatchingWorkingNotesSection(section, workingNotes.sections, index);
      if (!noteSection) {
        return section;
      }
      const sparkCandidates = readSpeakerTextList(noteSection.sparks, 4, 360);
      const quoteCandidates = [...(section.quotes || []), ...sparkCandidates];
      const rebalancedQuotes = rebalanceQuoteEntries(quoteCandidates, section.evidence || [], section.dialogue || []);
      const rebalancedEvidence = rebalanceEvidenceEntries(section.evidence || [], rebalancedQuotes);
      return {
        ...section,
        evidence: rebalancedEvidence,
        quotes: rebalancedQuotes,
        body: composeDraftSectionBody({
          ...section,
          evidence: rebalancedEvidence,
          quotes: rebalancedQuotes,
        }),
      };
    }),
  };
}

function readWorkingNotesFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const summary = readStringList(root.summary, 7, 180);
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (const item of sectionsRaw.slice(0, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const heading = cleanLine(item.heading, 60);
    const claims = readStringList(item.claims || item.bullets, 6, 180);
    const evidence = readSpeakerTextList(item.evidence || item.excerpts, 6, 320);
    const dialogue = normalizeDialogueEntries(readSpeakerTextList(item.dialogue, 4, 720), 3);
    const sparks = readSpeakerTextList(item.sparks, 4, 420);
    const gist = cleanLine(item.gist, 240) || cleanLine(claims[0] || evidence[0]?.text || dialogue[0]?.text || sparks[0]?.text, 240);
    if (!heading || !gist || (!claims.length && !evidence.length && !dialogue.length && !sparks.length)) {
      continue;
    }
    sections.push({ heading, gist, claims, evidence, dialogue, sparks });
  }

  if (!summary.length || !sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    summary,
    sections,
  };
}

export function normalizeWorkingNotes(input, fallbackTitle = "") {
  return readWorkingNotesFromUnknown(input, fallbackTitle);
}

function readBookletOutlineFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (let index = 0; index < sectionsRaw.length && index < 8; index += 1) {
    const item = sectionsRaw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const heading = cleanLine(item.heading, 60);
    const goal = cleanLine(item.goal, 120);
    const id = cleanLine(item.id, 40) || `section_${index + 1}`;
    if (!heading) {
      continue;
    }
    sections.push({
      id,
      heading,
      ...(goal ? { goal } : {}),
    });
  }

  if (!sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    sections,
  };
}

function readBookletDraftFromUnknown(input, fallbackTitle) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const root = input;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections = [];

  for (let index = 0; index < sectionsRaw.length && index < 8; index += 1) {
    const item = sectionsRaw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = cleanLine(item.id, 40) || `section_${index + 1}`;
    const heading = cleanLine(item.heading, 60);
    const intro = cleanParagraph(item.intro, 800);
    const claims = readStringList(item.claims, 6, 220);
    const why = readStringList(item.why, 5, 260);
    const butAlso = readStringList(item.butAlso, 5, 260);
    const buckets = dedupeDraftEntryBuckets(
      readSpeakerTextList(item.evidence, 6, 360),
      readSpeakerTextList(item.quotes, 4, 360),
      readSpeakerTextList(item.dialogue, 4, 720),
    );
    const evidence = buckets.evidence;
    const quotes = buckets.quotes;
    const dialogue = buckets.dialogue;
    const legacyBody = cleanBodyText(item.body, 4_000);
    const supportLines = mergeSupportLines(why, evidence);
    const hasStructuredContent = Boolean(intro || claims.length || supportLines.length || butAlso.length || quotes.length || dialogue.length);
    if (!heading || (!legacyBody && !hasStructuredContent)) {
      continue;
    }
    const section = { id, heading };
    if (intro) {
      section.intro = intro;
    }
    if (claims.length) {
      section.claims = claims;
    }
    if (supportLines.length) {
      section.why = supportLines;
    }
    if (butAlso.length) {
      section.butAlso = butAlso;
    }
    if (quotes.length) {
      section.quotes = quotes;
    }
    if (dialogue.length) {
      section.dialogue = dialogue;
    }
    const normalizedSection = applySectionStructureMode(section);
    normalizedSection.body = legacyBody || composeDraftSectionBody(normalizedSection);
    sections.push(normalizedSection);
  }

  if (!sections.length) {
    return null;
  }

  return {
    title: cleanLine(root.title, 120) || fallbackTitle,
    sections,
  };
}

function formatSpeakerText(entry) {
  if (!entry?.text) {
    return "";
  }
  return entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text;
}

function mergeSupportLines(why, evidence) {
  const merged = [];
  const seen = new Set();
  for (const item of why || []) {
    const line = cleanParagraph(item, 260);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(line);
  }
  for (const entry of evidence || []) {
    const line = cleanParagraph(formatSpeakerText(entry), 360);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(line);
  }
  return merged.slice(0, 6);
}

function countInteractionSignals(lines) {
  const joined = (lines || []).join(" ");
  if (!joined) {
    return 0;
  }
  const patterns = [
    /不是.*而是/,
    /意味着/,
    /因此|所以/,
    /前提/,
    /代价/,
    /更准确地说/,
    /不能简单/,
    /但|不过/,
  ];
  return patterns.reduce((count, pattern) => count + (pattern.test(joined) ? 1 : 0), 0);
}

function shouldUseContrastStructure(section) {
  const claimsCount = (section.claims || []).length;
  const whyCount = (section.why || []).length;
  const butAlsoCount = (section.butAlso || []).length;
  const dialogueCount = (section.dialogue || []).length;
  const intro = section.intro || "";
  const signalScore = countInteractionSignals([intro, ...(section.why || []), ...(section.butAlso || [])]);
  if (!claimsCount || !whyCount) {
    return false;
  }
  if (butAlsoCount > 0) {
    return true;
  }
  if (claimsCount >= 3 && whyCount >= 2 && signalScore >= 2 && dialogueCount <= 1) {
    return true;
  }
  return false;
}

function applySectionStructureMode(section) {
  if (shouldUseContrastStructure(section)) {
    return {
      ...section,
      structureMode: "contrast",
    };
  }
  return {
    ...section,
    evidence: section.why || [],
    why: [],
    butAlso: [],
    structureMode: "evidence",
  };
}

function composeLabeledParagraph(label, lines) {
  const filtered = lines.map((line) => cleanBodyText(line, 1_200)).filter(Boolean);
  if (!filtered.length) {
    return "";
  }
  return `${label}：${filtered.join("\n")}`;
}

function composeDraftSectionBody(section) {
  const paragraphs = [];
  if (section.intro) {
    paragraphs.push(composeLabeledParagraph("这一部分在讲什么", [section.intro]));
  }
  if (section.claims?.length || section.why?.length || section.butAlso?.length || section.evidence?.length) {
    const lines = [];
    if (section.claims?.length) {
      lines.push("主要观点");
      lines.push(...section.claims.map((claim) => `• ${claim}`));
    }
    if (section.why?.length) {
      lines.push("为什么这么说");
      lines.push(...section.why.map((item) => `• ${item}`));
    }
    if (section.butAlso?.length) {
      lines.push("但也要看到");
      lines.push(...section.butAlso.map((item) => `• ${item}`));
    }
    if (section.evidence?.length) {
      lines.push("主要论据与例子");
      lines.push(...section.evidence.map((item) => `• ${item}`));
    }
    paragraphs.push(composeLabeledParagraph("主要观点与论据", lines));
  }
  if (section.quotes?.length) {
    paragraphs.push(composeLabeledParagraph("原话摘录", section.quotes.map((entry) => `• ${formatSpeakerText(entry)}`)));
  }
  if (section.dialogue?.length) {
    paragraphs.push(composeLabeledParagraph("关键对话", section.dialogue.map((entry) => formatSpeakerText(entry))));
  }
  return paragraphs.filter(Boolean).join("\n\n");
}

function normalizeBaseUrl(input) {
  const baseUrl = String(input || DEFAULT_LLM_SETTINGS.llmBaseUrl).trim().replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new Error("模型 Base URL 不是合法网址。");
  }
  if (!SUPPORTED_LLM_HOSTS.has(parsed.hostname)) {
    throw new Error("当前扩展只允许连接 OpenRouter 或 OpenAI 官方接口。若要接别的兼容端点，请先把 host_permissions 加进 manifest。");
  }
  return baseUrl;
}

function normalizeReasoningEffort(input) {
  const normalized = String(input || DEFAULT_LLM_SETTINGS.reasoningEffort).trim().toLowerCase();
  return OPENROUTER_REASONING_EFFORTS.has(normalized) ? normalized : DEFAULT_LLM_SETTINGS.reasoningEffort;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function callJsonChatCompletion(params) {
  const apiKey = String(params.settings?.llmApiKey || "").trim();
  if (!apiKey) {
    throw new Error("请先在模型设置里填写 API key。");
  }

  const baseUrl = normalizeBaseUrl(params.settings?.llmBaseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (baseUrl.includes("openrouter.ai")) {
    Object.assign(headers, OPENROUTER_HEADERS);
  }
  const reasoningEffort = normalizeReasoningEffort(params.settings?.reasoningEffort);
  const requestBody = {
    model: params.settings.llmModel,
    temperature: params.temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: params.systemPrompt,
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
  };
  if (baseUrl.includes("openrouter.ai")) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  try {
    params.pushStage({
      stage: "llm_request",
      config: {
        endpoint,
        model: params.settings.llmModel,
        temperature: params.temperature,
        response_format: "json_object",
        reasoning: baseUrl.includes("openrouter.ai") ? { effort: reasoningEffort } : null,
      },
      input: {
        prompt_preview: params.prompt,
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(requestBody),
    });

    const payload = await readJsonResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    params.pushStage({
      stage: "llm_response",
      output: {
        http_status: response.status,
        raw_content_preview: typeof content === "string" ? content : null,
      },
    });

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.error?.code ||
        (typeof content === "string" ? content.slice(0, 300) : "") ||
        `HTTP ${response.status}`;
      throw new Error(`模型请求失败：${message}`);
    }

    const jsonCandidate = typeof content === "string" ? extractFirstJsonObject(content) : null;
    if (!jsonCandidate) {
      throw new Error("模型返回里没有找到可解析的 JSON 对象。");
    }
    return {
      endpoint,
      parsed: JSON.parse(jsonCandidate),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("模型请求超时了，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createStageCollector() {
  const stages = [];
  return {
    stages,
    pushStage(stage) {
      stages.push({
        ...stage,
        ts: new Date().toISOString(),
      });
    },
  };
}

export async function createWorkingNotesFromTranscript(params) {
  if (params.transcriptText.length > LLM_INPUT_MAX_CHARS) {
    throw new Error(`Transcript 太长了。当前上限是 ${LLM_INPUT_MAX_CHARS.toLocaleString()} 个字符。`);
  }

  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("notes");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "transcript",
    input: {
      transcript_chars: params.transcriptText.length,
      source_type: "transcript",
      source_ref: sourceRef ?? null,
      transcript_preview: params.transcriptText,
    },
    config: {
      flow: "transcript_to_working_notes",
      one_pass: true,
      segmentation: "disabled",
      input_cap_chars: LLM_INPUT_MAX_CHARS,
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.wnSystem || DEFAULT_PROMPTS.wnSystem;
  const userTemplate = params.settings.prompts?.wnUser || DEFAULT_PROMPTS.wnUser;
  const speakerMap = buildSpeakerMapFromTranscript(params.transcriptText);
  const speakerHints = buildSpeakerHintsText(params.transcriptText);

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    speakerHints,
    transcriptText: params.transcriptText,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.2,
    pushStage,
  });
  const workingNotes = applySpeakerMapToWorkingNotes(readWorkingNotesFromUnknown(result.parsed, params.title), speakerMap);
  stages[stages.length - 1].output.parse_ok = Boolean(workingNotes);

  if (!workingNotes) {
    throw new Error("模型返回了内容，但没法解析成合格的 Working Notes。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    working_notes: workingNotes,
    stages,
    traceability: {
      source_type: "transcript",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
      speaker_hints: speakerHints,
    },
  };
}

export async function createBookletOutlineFromWorkingNotes(params) {
  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("outline");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "normalization",
    input: {
      source_type: "working_notes",
      source_ref: sourceRef ?? null,
      section_count: params.workingNotes.sections.length,
      summary_count: params.workingNotes.summary.length,
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2),
    },
    config: {
      flow: "working_notes_to_booklet_outline",
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.outlineSystem || DEFAULT_PROMPTS.outlineSystem;
  const userTemplate = params.settings.prompts?.outlineUser || DEFAULT_PROMPTS.outlineUser;

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.2,
    pushStage,
  });
  const bookletOutline = readBookletOutlineFromUnknown(result.parsed, params.title);
  stages[stages.length - 1].output.parse_ok = Boolean(bookletOutline);

  if (!bookletOutline) {
    throw new Error("模型返回了内容，但没法解析成合格的 Booklet Outline。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    booklet_outline: bookletOutline,
    stages,
    traceability: {
      source_type: "working_notes",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}

export async function createBookletDraftFromOutline(params) {
  const { stages, pushStage } = createStageCollector();
  const jobId = createLocalId("draft");
  const createdAt = new Date().toISOString();
  const sourceRef = typeof params.metadata?.episode_url === "string" ? params.metadata.episode_url : undefined;

  pushStage({
    stage: "normalization",
    input: {
      source_type: "booklet_outline",
      source_ref: sourceRef ?? null,
      outline_section_count: params.bookletOutline.sections.length,
      notes_section_count: params.workingNotes.sections.length,
      outline_preview: JSON.stringify(params.bookletOutline, null, 2),
      working_notes_preview: JSON.stringify(params.workingNotes, null, 2),
    },
    config: {
      flow: "booklet_outline_to_booklet_draft",
      one_pass: true,
      execution_mode: "extension_local",
    },
  });

  const systemPrompt = params.settings.prompts?.draftSystem || DEFAULT_PROMPTS.draftSystem;
  const userTemplate = params.settings.prompts?.draftUser || DEFAULT_PROMPTS.draftUser;

  const prompt = buildPrompt(userTemplate, {
    title: params.title,
    language: params.language,
    workingNotes: params.workingNotes,
    bookletOutline: params.bookletOutline,
  });

  const result = await callJsonChatCompletion({
    settings: params.settings,
    prompt,
    systemPrompt,
    temperature: params.settings.temperature ?? 0.3,
    pushStage,
  });
  const speakerMap = new Map();
  for (const section of params.workingNotes.sections || []) {
    for (const entry of [...(section.evidence || []), ...(section.dialogue || []), ...(section.sparks || [])]) {
      const normalized = normalizeSpeakerLabel(entry.speaker);
      if (normalized && entry.speaker && !/^发言人\d+$/i.test(normalized) && !/^speaker\d+$/i.test(normalized)) {
        speakerMap.set(normalized, entry.speaker);
      }
    }
  }
  const parsedDraft = applySpeakerMapToDraft(readBookletDraftFromUnknown(result.parsed, params.title), speakerMap);
  const bookletDraft = enrichDraftQuotesFromWorkingNotes(parsedDraft, params.workingNotes);
  stages[stages.length - 1].output.parse_ok = Boolean(bookletDraft);

  if (!bookletDraft) {
    throw new Error("模型返回了内容，但没法解析成合格的 Booklet Draft。");
  }

  return {
    job_id: jobId,
    status: "succeeded",
    created_at: createdAt,
    booklet_draft: bookletDraft,
    stages,
    traceability: {
      source_type: "booklet_outline",
      source_ref: sourceRef ?? "internal://source-ref",
      generated_at: new Date().toISOString(),
    },
  };
}
