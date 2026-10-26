export interface PromptInput {
  readonly language: 'zh' | 'en'
  readonly cwd: string
  readonly sessionId: string
  readonly createdAt: string
  readonly model: string
  readonly messageCount: number
  readonly focus: string
  readonly extraInstructions: string
  readonly transcript: string
  readonly truncated: boolean
}

export interface Prompt {
  readonly system: string
  readonly user: string
}

const SECTIONS_ZH = [
  '## 任务',
  '## 已完成',
  '## 当前进展',
  '## 下一步',
  '## 未完成 / 风险',
  '## 踩坑与规避',
  '## 关键文件与命令',
  '## 给下一个会话的开场白',
] as const

const SECTIONS_EN = [
  '## Task',
  '## Done',
  '## Where things stand',
  '## Next steps',
  '## Open items and risks',
  '## Traps and how to avoid them',
  '## Key files and commands',
  '## Opening message for the next session',
] as const

const SYSTEM_ZH = `你是 DeepSeek Harness 的交接文档撰写器。用户会给你一段编程会话记录（用户、助手、工具调用与结果）。你的读者是「下一个接手这个任务的 AI 会话」——它完全没有这段对话的上下文，只有你写的这份文档。

写作要求：
1. 只写记录里能证实的事实。不确定的地方写「待确认」，不要猜测、不要补全。
2. 具体优先：文件名、命令、报错原文、接口名、关键数值，以及做出某个决定的理由。
3. 不复述对话，不写寒暄和过程流水账；读者要的是状态与判断，不是剧情。
4. 只输出 markdown 正文：不要一级标题，不要用代码块包住整篇文档。
5. 严格按下面小节与顺序输出，一个都不能少；某节确实没有内容时写「（无）」：
${SECTIONS_ZH.join('\n')}
6. 总长度控制在 1200 字以内，信息密度优先。
7. 「给下一个会话的开场白」必须是一段可直接粘贴的话：要读哪些文件、当前状态、第一件要做的事。`

const SYSTEM_EN = `You write handoff documents for DeepSeek Harness. The user gives you a programming session transcript (user, assistant, tool calls and results). Your reader is "the next AI session that takes over this work" — it has none of this conversation's context, only your document.

Rules:
1. State only what the transcript supports. Mark unknowns as "unconfirmed"; never guess or fill gaps.
2. Prefer specifics: file paths, commands, verbatim error text, API names, key numbers, and why a decision was made.
3. Do not retell the conversation. No pleasantries, no play-by-play; the reader needs state and judgement.
4. Output markdown body only: no top-level heading, no code fence around the whole document.
5. Follow these sections in this exact order. Never skip one; write "(none)" when a section genuinely has nothing:
${SECTIONS_EN.join('\n')}
6. Keep it under 800 words. Density beats completeness.
7. "Opening message for the next session" must be a ready-to-paste paragraph: what to read, where things stand, and the first action.`

function line(label: string, value: string | number): string {
  return `- ${label}：${value}`
}

function lineEn(label: string, value: string | number): string {
  return `- ${label}: ${value}`
}

/** Build the summarizer prompt for one session. */
export function buildPrompt(input: PromptInput): Prompt {
  const zh = input.language === 'zh'
  const system = zh ? SYSTEM_ZH : SYSTEM_EN
  const meta: string[] = zh
    ? [
        line('工作目录', input.cwd),
        line('会话 ID', input.sessionId),
        line('生成时间', input.createdAt),
        line('模型', input.model),
        line('消息数', input.messageCount),
        line('记录是否被截断', input.truncated ? '是（中间部分已省略）' : '否'),
      ]
    : [
        lineEn('Working directory', input.cwd),
        lineEn('Session', input.sessionId),
        lineEn('Generated at', input.createdAt),
        lineEn('Model', input.model),
        lineEn('Messages', input.messageCount),
        lineEn('Transcript truncated', input.truncated ? 'yes (middle omitted)' : 'no'),
      ]

  if (input.focus !== '') meta.push(zh ? `- 本次关注点：${input.focus}` : `- Focus for this handoff: ${input.focus}`)
  if (input.extraInstructions !== '') {
    meta.push(zh ? `- 额外要求：${input.extraInstructions}` : `- Extra requirements: ${input.extraInstructions}`)
  }

  const header = zh ? '会话信息' : 'Session facts'
  const recordLabel = zh ? '会话记录' : 'Session transcript'
  const footer = zh
    ? '请按要求的格式输出交接文档正文。'
    : 'Write the handoff document body in the required format.'

  return {
    system,
    user: `${header}\n${meta.join('\n')}\n\n<${recordLabel}>\n${input.transcript}\n</${recordLabel}>\n\n${footer}`,
  }
}

/** Section headings the model is asked to emit, exported for tests and doc tooling. */
export function expectedSections(language: 'zh' | 'en'): readonly string[] {
  return language === 'zh' ? SECTIONS_ZH : SECTIONS_EN
}
