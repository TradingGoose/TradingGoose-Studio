import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetResolvedSystemSettings } = vi.hoisted(() => ({
  mockGetResolvedSystemSettings: vi.fn(),
}))

vi.mock('@/lib/system-settings/service', () => ({
  getResolvedSystemSettings: mockGetResolvedSystemSettings,
}))

describe('email utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the configured email domain from system settings', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
    })

    const { getConfiguredEmailDomain } = await import('./utils')

    await expect(getConfiguredEmailDomain()).resolves.toBe('mail.example.com')
  })

  it('returns the stored from email address when configured', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      emailDomain: 'mail.example.com',
      fromEmailAddress: 'TradingGoose <noreply@mail.example.com>',
    })

    const { getFromEmailAddress } = await import('./utils')

    await expect(getFromEmailAddress()).resolves.toBe(
      'TradingGoose <noreply@mail.example.com>'
    )
  })

  it('builds the default from email address from the configured domain when unset', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
    })

    const { getFromEmailAddress } = await import('./utils')

    await expect(getFromEmailAddress()).resolves.toBe('noreply@mail.example.com')
  })

  it('builds the help email address from the configured domain', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      emailDomain: 'mail.example.com',
      fromEmailAddress: null,
    })

    const { getHelpEmailAddress } = await import('./utils')

    await expect(getHelpEmailAddress()).resolves.toBe('help@mail.example.com')
  })
})
