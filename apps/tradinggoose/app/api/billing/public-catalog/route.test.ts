import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public catalog boundary', () => {
  it('continues to use the public-only catalog owner', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    expect(source).toContain('getPublicBillingCatalog')
    expect(source).not.toContain('privateTierAccess')
    expect(source).not.toContain('accessCode')
  })
})
