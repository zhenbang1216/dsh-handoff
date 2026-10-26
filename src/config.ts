import Schema from '@deepseek-ai/schemastery'

/** Language of the generated document. `auto` follows the conversation. */
export type HandoffLanguage = 'auto' | 'zh' | 'en'

/** Effective plugin configuration. Every field has a default, so an empty entry is valid. */
export interface HandoffConfig {
  /** Directory for generated documents, relative to the session working directory. */
  outputDir: string
  /** Prefix of every generated file name. */
  filenamePrefix: string
  /** Keep a `latest.md` copy beside the timestamped documents. */
  writeLatest: boolean
  /** Provider route override; set together with `model`, or leave both empty to inherit. */
  provider: string
  /** Model override; set together with `provider`. */
  model: string
  /** Transcript character budget sent to the summarizer. */
  maxInputChars: number
  /** Output-token cap for the summarizer call. */
  maxOutputTokens: number
  /** Include tool results in the transcript. */
  includeToolResults: boolean
  /** Include harness-injected user-role context (skill catalogs, workspace notes). */
  includeInjectedContext: boolean
  /** Include the assistant's reasoning blocks in the transcript. */
  includeReasoning: boolean
  /** Language of the generated document. */
  language: HandoffLanguage
  /** Extra free-form instructions appended to the summarizer prompt. */
  extraInstructions: string
}

/**
 * Plain configuration. These are ordinary profile-entry values: a change is
 * saved to the profile patch and takes effect on the next mount, which is the
 * right granularity for a batch job like this one. (`volatile()` is for config
 * references and would turn every value into a reference object.)
 */
export const Config = Schema.object({
  outputDir: Schema.string().default('.dsh/handoff').description('生成目录，相对于会话工作目录。'),
  filenamePrefix: Schema.string().default('handoff').description('文件名前缀，例如 handoff-20261025-2140-xxx.md。'),
  writeLatest: Schema.boolean().default(true).description('同时写一份 latest.md，方便下一个会话直接读取。'),
  provider: Schema.string().default('').description('模型 provider；与 model 同时填写才生效，否则沿用会话当前模型。'),
  model: Schema.string().default('').description('模型 id；与 provider 同时填写才生效。'),
  maxInputChars: Schema.number()
    .default(48_000)
    .min(4_000)
    .description('会话记录的字符预算，超出时省略中间部分。'),
  maxOutputTokens: Schema.number().default(4_096).min(512).description('生成交接文档的输出 token 上限。'),
  includeToolResults: Schema.boolean().default(true).description('把工具结果写入会话记录（整段截断）。'),
  includeInjectedContext: Schema.boolean()
    .default(false)
    .description('把宿主注入的上下文（技能目录、工作区说明等）也写进记录；默认排除，避免挤占预算。'),
  includeReasoning: Schema.boolean().default(false).description('把助手的思考过程写入会话记录。'),
  language: Schema.union(['auto', 'zh', 'en'] as const)
    .default('auto')
    .description('文档语言：auto 跟随对话，或固定中文 / 英文。'),
  extraInstructions: Schema.string().default('').description('追加到总结提示词的额外要求。'),
})
