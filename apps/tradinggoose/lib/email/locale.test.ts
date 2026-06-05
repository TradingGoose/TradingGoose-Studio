import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockLimit } = vi.hoisted(() => {
  const mockLimit = vi.fn()
  const mockDbSelect = vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      limit: () => mockLimit(),
      where: vi.fn(() => builder),
    }

    return builder
  })

  return { mockDbSelect, mockLimit }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => mockDbSelect(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  settings: {
    preferredLocale: 'settings.preferredLocale',
    userId: 'settings.userId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
  },
  waitlist: {
    email: 'waitlist.email',
    preferredLocale: 'waitlist.preferredLocale',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ args, kind: 'eq' }),
}))

import { normalizeEmailLocale, resolveEmailLocale } from './locale'

describe('email locale resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes unsupported locale input to the default locale', () => {
    expect(normalizeEmailLocale('fr')).toBe('en')
    expect(normalizeEmailLocale(null)).toBe('en')
  })

  it('uses authenticated user settings as the canonical user locale source', async () => {
    mockLimit.mockResolvedValueOnce([{ preferredLocale: 'zh' }])

    await expect(resolveEmailLocale({ fallbackLocale: 'es', userId: 'user-1' })).resolves.toBe(
      'zh'
    )

    expect(mockDbSelect).toHaveBeenCalledTimes(1)
  })

  it('uses waitlist as the canonical anonymous durable locale source', async () => {
    mockLimit.mockResolvedValueOnce([])
    mockLimit.mockResolvedValueOnce([{ preferredLocale: 'es' }])

    await expect(resolveEmailLocale({ email: 'Guest@Example.com' })).resolves.toBe('es')

    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('falls back when no user or waitlist locale exists', async () => {
    mockLimit.mockResolvedValueOnce([])
    mockLimit.mockResolvedValueOnce([])

    await expect(
      resolveEmailLocale({ email: 'guest@example.com', fallbackLocale: 'zh' })
    ).resolves.toBe('zh')
  })
})
