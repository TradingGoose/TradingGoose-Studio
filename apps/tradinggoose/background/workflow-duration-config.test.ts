import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('workflow Trigger duration ownership', () => {
  it('leaves the root config without a duration and makes the drain explicitly unlimited', () => {
    const rootConfig = readFileSync(new URL('../trigger.config.ts', import.meta.url), 'utf8')
    const drain = readFileSync(new URL('./pending-execution-drain.ts', import.meta.url), 'utf8')

    expect(rootConfig).not.toContain('maxDuration')
    expect(drain).toContain('maxDuration: timeout.None')
    expect(drain).not.toContain('2_147_483_647')
  })
})
