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
5) gist 用 2-4 句说明这一节到底在讲什么，帮助后续写作快速进入这一节。
6) claims 只放这一节真正核心的判断，不要把例子、寒暄和泛泛总结混进去。claims 可以概括，但不要偷走原话应该承担的工作。
7) evidence 用来保留支撑 claims 的关键论据、例子或引述。优先保留 speaker；如果能判断说话人，请填写 speaker。text 必须尽量贴近 transcript 原话，不要把本来精彩的一句话改写成平平的外部总结。evidence 更适合保留“为什么这个判断成立”的材料：例子、场景、解释、背景、具体经历。
8) dialogue 用来保留一小段真正值得留下的多轮对话。优先保留 2-4 轮来回接话，而且至少应体现两位 speaker 的来回，不要把单人独白塞进 dialogue。
8.1) dialogue 的每一项都应该是一个完整的 exchange block，而不是一人一句拆开存。优先把 speaker 留空，把多轮发言直接连续保留在 text 里，例如“教主：…… Plus：…… 嘻哈：……”。如果你把一段对话拆成多个 item，后续会更容易失真。
8.2) dialogue 优先保留真正有互动感的片段：追问、回应、接梗、补强、翻转、反驳、互相吐槽。不要只因为两个人都在说同一个主题，就把两段相关发言并排塞进 dialogue。
9) 如果某条论据本身就是一句很有力的话，优先把它作为引述保留下来，而不是只写“某人认为……”。如果一段价值主要来自来回对话，不要只拆成零散句子，优先放进 dialogue。
10) sparks 用来保留特别值得留下的表达，例如好笑的话、锋利的判断、漂亮的比喻、或单句就很有记忆点的话。不是每节都必须有，但有价值时优先保留。sparks 偏单句火花，dialogue 偏多轮对话。单句如果脱离上下文也依然有劲、有画面、有播客感，优先进 sparks，不要只放进 evidence。
11) 如果 transcript 或 speaker hints 已经暴露真实名字，优先使用真实名字，不要退回“发言人1 / Speaker 1”这类泛标签。只有在名字确实无法判断时，才保留泛标签。
12) 不要发明时间戳、theme id、claim id、utterance id、support refs。
13) 不要做额外的分段策略设计；把这次输入当成单次 one-pass transcript 处理。
JSON schema:
{
  "title": string,
  "summary": string[],
  "sections": [
    {
      "heading": string,
      "gist": string,
      "claims": string[],
      "evidence": [
        {
          "speaker": string,
          "text": string
        }
      ],
      "dialogue": [
        {
          "speaker": string,
          "text": string
        }
      ],
      "sparks": [
        {
          "speaker": string,
          "text": string
        }
      ]
    }
  ]
}
上下文：title={{title}}; language={{language}}
speaker hints:
{{speakerHints}}
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
5) goal 要说清楚这一段想帮助读者理解什么。优先参考 working notes 里的 gist、claims、evidence、dialogue、sparks，体现“观点 / 论据 / 引述 / 对话”这一层组织意图，但不要写成长段正文。
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

  draftSystem: "你是 material draft 生成器。你的任务不是重新发明内容，而是基于 working notes 和 booklet outline 忠实整理出一份结构清楚、可存档、可回述的阅读材料 JSON。你更像编辑，不像散文作者。不得输出 schema 之外的内容。",
  draftUser: `任务：把 booklet outline 写成一份可阅读、可存档、可回述的材料 draft。
只输出一个 JSON 对象，不要 markdown，不要解释，不要额外文字。
目标：先产出一版信息密度高的材料，而不是散文化的小作文。
严格要求：
1) 只能使用传入的 working notes 和 booklet outline，不得使用外部知识。
2) sections 顺序必须和 outline 一致。
3) 每段必须保留 outline 里的 id 和 heading。
4) 不要再把一切都熔进一个 body 字符串里。每节请直接输出半结构化字段，让原话、关键对话和解释分开。
5) 每节优先包含这些字段，但按内容需要灵活取舍，不要为了凑字段硬写：
   - intro：这一部分在讲什么
   - claims：主要观点
   - why：为什么这么说（默认的支撑层，所有 section 都应尽量有）
   - butAlso：但也要看到（当这一节存在明显的补充、限制、另一面或前提时）
   - quotes：真正值得保留的原话摘录
   - dialogue：关键对话 / 对话火花（如果这一段确实有）
6) 写每一节时，优先按这个映射使用 working notes：
   - 用 gist 写 intro
   - 用 claims 写 claims
   - 用 evidence 和必要的 dialogue 整理成 why
   - 如果这一节天然带有“为什么成立”和“但不能只这么看”两个层次，再额外写 butAlso
   - 用 sparks 写 quotes
   - 用 dialogue 写 dialogue
7) claims 之间如果是不同层次或不同角度，不要合并成一个更平滑的大判断；尽量保留它们的区别。
8) why 是默认的“主要论据”层。它更适合放支持这个判断的解释、例子、因果链条、现实机制，也可以吸收带 attribution 的近乎原话。不要再额外输出一个和 why 并列的 evidence 层。
9) 如果不同 speaker 提供了不同角度、补充或回应，why 里尽量明确是谁提供了哪种支撑，不要压成匿名共识。
10) quotes 必须优先保留真正值得记住的原句，不要把 quote 改写成“某人强调……”这种转述。如果 working notes 里已经有很强的 sparks，可以直接搬过来。quotes 应该更像单独摘出来也有魅力的一句话：更短、更锋利、更好记、更有播客感。
11) dialogue 用来保留一小段来回对话。优先直接保留“谁说了什么”的原貌，不要把这段对话再概括成一条结论。每个 dialogue item 最好就是一个完整 exchange block；若一段 dialogue 包含多位 speaker，优先把 speaker 留空，把多轮发言直接写进 text。优先选追问、回应、接梗、补强、翻转、反驳这些高互动片段。
12) intro 可以解释，但 quotes 和 dialogue 应尽量保持原话魅力，不要为了“行文稳”把它们抹平。
13) 只有当一节里同时存在“这一点为什么成立”和“但也要看到什么”这两个层次时，才使用 butAlso。不要为了追求形式感，给每一节都强行加对照结构。
14) butAlso 更适合放前提、代价、限制条件、另一面、不能过度理解的地方。每条 butAlso 都要把主语写完整，不要用“这”“这种”“它”“这类说法”这种悬空指代开头；读者不应该自己补主语。
15) 为什么这么说 和 但也要看到 不要在同一节里重复讲同一句话；如果 butAlso 已经承担了修正层，就不要再把同样的意思塞回 why。
16) 不要发明新事实，不要把弱判断写成强结论，也不要为了流畅度删除关键分歧。
17) 写作优先级是：忠实于 notes > 保留原话魅力和对话感 > 保留 distinctions（不同人的角度、不同层次的判断） > 清楚可读 > prose 顺滑。
18) 不要发明 body、actions、memory、theme id、support refs，也不要再输出 evidence 这种并列支撑层。
JSON schema:
{
  "title": string,
  "sections": [
    {
      "id": string,
      "heading": string,
      "intro": string,
      "claims": string[],
      "why": string[],
      "butAlso": string[],
      "quotes": [
        {
          "speaker": string,
          "text": string
        }
      ],
      "dialogue": [
        {
          "speaker": string,
          "text": string
        }
      ]
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
