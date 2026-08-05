import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('workflow Trigger duration ownership', () => {
  it('keeps a valid root maximum while making the drain explicitly unlimited', () => {
    const rootConfig = readFileSync(new URL('../trigger.config.ts', import.meta.url), 'utf8')
    const drain = readFileSync(new URL('./pending-execution-drain.ts', import.meta.url), 'utf8')
    const configuredMaximum = rootConfig.match(/\bmaxDuration:\s*(\d+)/)?.[1]

    expect(configuredMaximum).toBeDefined()
    expect(Number(configuredMaximum)).toBeGreaterThanOrEqual(600)
    expect(drain).toContain('maxDuration: timeout.None')
    expect(drain).not.toContain('2_147_483_647')
  })
})
