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
