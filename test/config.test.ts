import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'

describe('Config schema', () => {
  it('fills every default', () => {
    const config = Config({})
    expect(config.outputDir).toBe('.dsh/handoff')
    expect(config.filenamePrefix).toBe('handoff')
    expect(config.writeLatest).toBe(true)
    expect(config.language).toBe('auto')
    expect(config.maxInputChars).toBe(48_000)
    expect(config.maxOutputTokens).toBe(4_096)
    expect(config.includeToolResults).toBe(true)
    expect(config.includeInjectedContext).toBe(false)
    expect(config.includeReasoning).toBe(false)
  })

  it('rejects an unknown language', () => {
    expect(() => Config({ language: 'fr' } as never)).toThrow()
  })

  it('rejects an input budget below the floor', () => {
    expect(() => Config({ maxInputChars: 100 } as never)).toThrow()
  })
})
