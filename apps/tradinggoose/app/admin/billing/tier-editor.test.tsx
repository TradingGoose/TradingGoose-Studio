import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin tier editor access-code contract', () => {
  it('owns private access-code mapping and public clearing', () => {
    const source = readFileSync(new URL('./tier-editor.tsx', import.meta.url), 'utf8')
    expect(source).toContain('accessCode: isPublic ? null : readOptionalText')
    expect(source).toContain("id='accessCode'")
    expect(source).not.toContain('requireStripeMonthlyPriceId')
  })
})

describe('admin tier editor execution throughput layout', () => {
  it('pairs concurrency and workflow execution time limits in one responsive row', () => {
    const source = readFileSync(new URL('./tier-editor.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(
      /<div className='grid gap-4 md:grid-cols-2'>\s*<FieldShell\s+id='concurrencyLimit'[\s\S]*?<\/FieldShell>\s*<FieldShell\s+id='workflowExecutionTimeLimitSeconds'[\s\S]*?<\/FieldShell>\s*<\/div>/
    )
    expect(source).toContain('workflowExecutionTimeLimitSeconds: readOptionalInteger')
    expect(source).toContain("min='1'")
    expect(source).toContain("step='1'")
  })
})
