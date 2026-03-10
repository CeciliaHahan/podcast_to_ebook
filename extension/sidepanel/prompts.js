export const DEFAULT_PROMPTS = {
  wnSystem: "你是 transcript working-notes 生成器。你的任务是把 transcript 压缩成一份带少量证据线索的 working notes JSON，供后续生成阅读材料使用。不得输出 schema 之外的内容。",
  wnUser: `任务：把 transcript 转成用于后续生成阅读材料的 working notes。
只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。
working notes 只服务于后续结构整理和材料写作，不是最终 ebook。
严格要求：
1) 只能使用 transcript 本身，不得使用外部知识。
2) summary 用来概括这期最重要的结论，按内容需要写，不要为了凑数量写空话。
3) sections 按内容自然分组，不要机械凑固定段数；只要覆盖完整且结构清楚即可。
4) 每段 section 的 heading 要具体，像一个读者能理解的小标题，而不是空泛主题词。
5) bullets 要保留这一段真正重要的观点、论据、例子或分歧，不要只写泛泛总结。
6) excerpts 必须来自 transcript，尽量保留原话；如果能判断说话人，请在摘录里直接保留说话人信息，例如“发言人2：……”或“主持人：……”。不要为了格式美观去删掉说话人。
7) 如果某一段里有特别有代表性的表达、好笑的话、锋利的判断或精彩的碰撞，优先保留进 excerpts。
8) 不要发明时间戳、theme id、claim id、utterance id、support refs。
9) 不要做额外的分段策略设计；把这次输入当成单次 one-pass transcript 处理。
JSON schema:
{
  "title": string,
  "summary": string[],
  "sections": [
    {
      "heading": string,
      "bullets": string[],
      "excerpts": string[]
    }
  ]
}
上下文：title={{title}}; language={{language}}
transcript:
{{transcriptText}}`,

  outlineSystem: "你是 booklet outline 生成器。你的任务是把 working notes 转成 title + ordered sections 的 JSON。不得输出 schema 之外的内容。",
  outlineUser: `任务：把 working notes 转成 booklet outline。
只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。
目标：先产出一个可检查的章节顺序，不写最终正文。
严格要求：
1) 只能使用传入的 working notes，不得使用外部知识。
2) sections 数量按内容需要决定；目标是让结构更清楚，而不是追求固定段数。
3) 每段必须有 id 和 heading，可以有 goal。
4) heading 要像材料里的正式小标题，避免空泛词。
5) goal 要说清楚这一段想帮助读者理解什么，最好体现“观点 / 论据 / 引述”这一层组织意图，但不要写成长段正文。
6) 不要发明 quotes、actions、memory、segmentation 之类额外结构。
JSON schema:
{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "goal": string
    }
  ]
}
上下文：title={{title}}; language={{language}}
working notes:
{{workingNotes}}`,

  draftSystem: "你是 material draft 生成器。你的任务是把 working notes 和 booklet outline 写成一份结构清楚、可存档、可回述的阅读材料 JSON。不得输出 schema 之外的内容。",
  draftUser: `任务：把 booklet outline 写成一份可阅读、可存档、可回述的材料 draft。
只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。
目标：先产出一版信息密度高的材料，而不是散文化的小作文。
严格要求：
1) 只能使用传入的 working notes 和 booklet outline，不得使用外部知识。
2) sections 顺序必须和 outline 一致。
3) 每段必须保留 outline 里的 id 和 heading。
4) body 不要写成一整段泛泛 prose；要写成半结构化材料体，用几个短段落组织清楚内容。
5) body 优先包含这些层次，但按内容需要灵活取舍，不要被固定数量绑死：
   - 这一部分在讲什么
   - 主要观点
   - 主要论据与例子
   - 原话摘录
   - 对话火花（如果这一段确实有）
6) body 可以用带提示词的短段落来组织，例如“这一部分在讲什么：……”“主要观点：……”“主要论据与例子：……”“原话摘录：……”。不要写成 markdown 列表，也不要用过多格式符号。
7) 原话摘录尽量保留说话人；如果 working notes 的 excerpts 里已经带说话人，优先沿用。
8) 对话火花只在有价值时保留；不要为了凑格式硬写。
9) body 尽量用 working notes 里的 bullets 和 excerpts 作为依据，不要发明新事实，不要把弱判断写成强结论。
10) 不要发明 quotes、actions、memory、theme id、support refs 之类额外结构。
JSON schema:
{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "body": string
    }
  ]
}
上下文：title={{title}}; language={{language}}
working notes:
{{workingNotes}}
booklet outline:
{{bookletOutline}}`
};

export function buildPrompt(template, params) {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    let replacement = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), replacement);
  }
  return result;
}
