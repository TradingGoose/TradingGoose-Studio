import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin tier create route contract', () => {
  it('normalizes and persists private access codes with the uniqueness backstop', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    expect(source).toContain('const accessCode = parsed.data.accessCode')
    expect(source).toContain('privateTierAccessCodeExists')
    expect(source).toContain('isAccessCodeUniqueViolation')
    expect(source).toContain('accessCode,')
  })
})
