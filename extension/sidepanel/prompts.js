export const WORKING_NOTES_SYSTEM_PROMPT = "你是 transcript working-notes 生成器。你的任务是把 transcript 压缩成 summary + sections + excerpts 的 JSON，供后续 outline 使用。不得输出 schema 之外的内容。";

export function buildWorkingNotesPrompt(params) {
  return [
    "任务：把 transcript 转成用于后续生成 booklet 的 working notes。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "working notes 只服务于下一步 outline，不是最终 ebook。",
    "严格要求：",
    "1) 只能使用 transcript 本身，不得使用外部知识。",
    "2) summary 写 3-7 条，尽量具体，不要空话。",
    "3) sections 写 3-6 段，每段包含 heading、bullets、excerpts。",
    "4) excerpts 必须是 transcript 里的短摘录，尽量保留原话，不要改写成总结句。",
    "5) 不要发明时间戳、speaker、theme id、claim id、utterance id。",
    "6) 不要做分段策略设计；把这次输入当成单次 one-pass transcript 处理。",
    "JSON schema:",
    `{
  "title": string,
  "summary": string[],
  "sections": [
    {
      "heading": string,
      "bullets": string[],
      "excerpts": string[]
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "transcript:",
    params.transcriptText,
  ].join("\n");
}

export const OUTLINE_SYSTEM_PROMPT = "你是 booklet outline 生成器。你的任务是把 working notes 转成 title + ordered sections 的 JSON。不得输出 schema 之外的内容。";

export function buildOutlinePrompt(params) {
  return [
    "任务：把 working notes 转成 booklet outline。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "目标：先产出一个可检查的章节顺序，不写最终正文。",
    "严格要求：",
    "1) 只能使用传入的 working notes，不得使用外部知识。",
    "2) sections 保持 3-6 段，顺序要尽量自然。",
    "3) 每段必须有 id 和 heading，可以有 goal。",
    "4) goal 要说清楚这一段想帮助读者理解什么，但不要写成长段正文。",
    "5) 不要发明 quotes、actions、memory、segmentation 之类额外结构。",
    "JSON schema:",
    `{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "goal": string
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "working notes:",
    JSON.stringify(params.workingNotes, null, 2),
  ].join("\n");
}

export const DRAFT_SYSTEM_PROMPT = "你是 booklet draft 生成器。你的任务是把 working notes 和 booklet outline 写成 title + sections(body) 的 JSON。不得输出 schema 之外的内容。";

export function buildDraftPrompt(params) {
  return [
    "任务：把 booklet outline 写成一个可阅读的 booklet draft。",
    "只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。",
    "目标：先产出一版可读正文，后面再决定是否继续润色。",
    "严格要求：",
    "1) 只能使用传入的 working notes 和 booklet outline，不得使用外部知识。",
    "2) sections 顺序必须和 outline 一致。",
    "3) 每段必须保留 outline 里的 id 和 heading。",
    "4) body 写成自然、清楚、简洁的正文，不要写成要点列表。",
    "5) body 尽量用 working notes 里的 bullets 和 excerpts 作为依据，不要发明新事实。",
    "6) 不要发明 quotes、actions、memory、theme id、support refs 之类额外结构。",
    "JSON schema:",
    `{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "body": string
    }
  ]
}`,
    `上下文：title=${params.title}; language=${params.language}`,
    "working notes:",
    JSON.stringify(params.workingNotes, null, 2),
    "booklet outline:",
    JSON.stringify(params.bookletOutline, null, 2),
  ].join("\n");
}
