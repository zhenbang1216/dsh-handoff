import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.ts'
import type { HandoffConfig } from './config.ts'
import { describeError, HandoffError } from './errors.ts'
import { generateHandoff } from './generate.ts'
import { mountRoutes } from './routes.ts'
import { frameForInjection, loadHandoffForResume } from './resume.ts'

export const name = 'dsh-handoff'
export { Config }

/** The tool and the command both need the model service; commands are optional. */
export const inject = ['tools', 'llm']

/** Structural view of the agent handed to a tool execution or a command. */
interface AgentLike {
  readonly session: Session
  /** Adds model-facing context without waking the driver. */
  readonly inject?: (input: { content: unknown[]; source: { kind: string } }) => unknown
}

const TOOL_DESCRIPTION = [
  '把当前会话整理成一份交接文档（markdown），写给「下一个接手这个任务的会话」：任务是什么、已完成什么、',
  '当前进展、下一步、未完成项与风险、踩过的坑、关键文件与命令，以及一段可直接粘贴的开场白。',
  '文档写入会话工作目录下的 .dsh/handoff/（可在插件设置中改）。',
  '适用场景：用户要求交接/总结现状/收尾；或上下文即将耗尽而任务未完成，需要新会话继续。',
  '不要用它代替普通回答，也不要在用户没有要求、任务也还不需要交接时调用。',
].join('')

/** Trim a markdown body to a short tool-result preview. */
function previewOf(markdown: string, limit = 240): string {
  const body = markdown
    .replace(/^---\n[\s\S]*?\n---\n/u, '')
    .replace(/^# [^\n]*\n+/u, '')
    .trim()
  const text = body.replace(/\s+/gu, ' ')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Build the summarizer tool bound to this plugin instance's configuration. */
function createTool(ctx: Context, config: HandoffConfig) {
  return defineTool({
    name: 'handoff',
    description: TOOL_DESCRIPTION,
    parameters: {
      focus: {
        type: 'string',
        description: '这次交接要特别强调的点，例如「重点写测试与未修完的 bug」；可省略。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          messages: { type: 'integer', required: true },
          chars: { type: 'integer', required: true },
          model: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          preview: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        const truncated = value.truncated ? '，记录中段已省略' : ''
        return [
          {
            type: 'text',
            text: `交接文档已写入 ${value.path}（${value.messages} 条消息，${value.chars} 字符记录${truncated}，模型 ${value.model}）。\n\n预览：${value.preview}`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const agent = exec.agent as AgentLike | undefined
      if (agent === undefined) throw new HandoffError('NO_AGENT', '这个工具必须在一个会话里运行。')
      const result = await generateHandoff({
        ctx,
        session: agent.session,
        config,
        focus: args.focus?.trim() ?? '',
        signal: exec.signal,
      })
      return {
        path: result.relativePath,
        messages: result.stats.messages,
        chars: result.stats.chars,
        model: `${result.route.provider}/${result.route.model}`,
        truncated: result.stats.truncated,
        preview: previewOf(result.markdown),
      }
    },
  })
}

/** Inject the chosen handoff document into the session as model-facing context. */
async function resumeIntoSession(
  invocation: CommandInvocation,
  requested: string,
  config: HandoffConfig,
): Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }> {
  try {
    const resumed = await loadHandoffForResume(invocation.agent.session, config, requested)
    const agent = invocation.agent as unknown as AgentLike
    if (typeof agent.inject !== 'function') {
      return { kind: 'error', text: '当前宿主不支持向会话注入上下文，无法接续。' }
    }
    await agent.inject({
      content: [{ type: 'text', text: frameForInjection(resumed) }],
      source: { kind: 'dsh-handoff' },
    })
    const size = resumed.content.length
    return {
      kind: 'success',
      text: `已把 ${resumed.name} 注入当前会话（${size} 字符${resumed.truncated ? '，已截断' : ''}）。模型在下一步就会读到它。`,
    }
  } catch (error) {
    return { kind: 'error', text: `接续失败：${describeError(error)}` }
  }
}

/**
 * Register the handoff tool, and the `/handoff` command when the composition
 * provides a command surface (the Web client does; headless runs do not).
 */
export function apply(ctx: Context, config: HandoffConfig): void {
  ctx.effect(() => ctx.tools.register(createTool(ctx, config)), 'dsh-handoff: handoff tool')
  mountRoutes(ctx, config)

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          name: 'handoff',
          description: '生成或接续交接文档：/handoff [关注点] 生成，/handoff resume [文件名] 注入当前会话',
          input: { hint: '[关注点] 或 resume [文件名]' },
          async handler(invocation: CommandInvocation) {
            const raw = invocation.rawInput.trim()
            if (raw === 'resume' || raw.startsWith('resume ')) {
              return resumeIntoSession(invocation, raw.slice('resume'.length).trim(), config)
            }
            try {
              const result = await generateHandoff({
                ctx,
                session: invocation.agent.session,
                config,
                focus: raw,
                signal: invocation.signal,
              })
              const parts = [
                `交接文档已生成：${result.relativePath}`,
                `（${result.stats.messages} 条消息，${result.stats.chars} 字符记录，模型 ${result.route.provider}/${result.route.model}）`,
              ]
              if (result.stats.truncated) parts.push('，会话中段因超出预算已省略')
              return { kind: 'success', text: parts.join('') } as const
            } catch (error) {
              return { kind: 'error', text: `交接文档生成失败：${describeError(error)}` } as const
            }
          },
        }),
      'dsh-handoff: /handoff command',
    )
  })
}
