import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLUGIN_VERSION } from '../src/version.ts'

describe('PLUGIN_VERSION', () => {
  it('matches the package manifest', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }
    expect(PLUGIN_VERSION).toBe(manifest.version)
  })
})
