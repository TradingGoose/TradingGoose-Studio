import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('private tier access query ownership', () => {
  it('owns GET/POST keys and canonical invalidation', () => {
    const source = readFileSync(new URL('./private-tier-access.ts', import.meta.url), 'utf8')
    expect(source).toContain('privateTierAccessKeys.current()')
    expect(source).toContain("method: 'POST'")
    expect(source).toContain('queryClient.invalidateQueries')
    expect(source).toContain('subscriptionKeys.user()')
    expect(source).toContain('validateAccessCode')
    expect(source).not.toContain('publicBillingCatalogKeys')
  })
})
