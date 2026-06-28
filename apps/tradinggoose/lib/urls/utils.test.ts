import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}))

vi.mock('@/lib/env', () => ({
  getEnv: (key: string) => mockEnv[key],
}))

import { getBaseDomain, getBaseUrl, getEmailDomain } from './utils'

describe('url helpers', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
    mockEnv.NEXT_PUBLIC_APP_URL = 'https://www.tradinggoose.ai'
  })

  it('uses NEXT_PUBLIC_APP_URL as the base URL', () => {
    expect(getBaseUrl()).toBe('https://www.tradinggoose.ai')
  })

  it('uses the request origin when a request is provided', () => {
    const request = new Request('https://preview.example.test/api/auth/mcp/start')

    expect(getBaseUrl(request)).toBe('https://preview.example.test')
  })

  it('treats preview and production as configured app URLs', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = 'https://preview.tradinggoose.ai'

    expect(getBaseUrl()).toBe('https://preview.tradinggoose.ai')
  })

  it('derives the base domain only from NEXT_PUBLIC_APP_URL', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = 'https://www.tradinggoose.ai'

    expect(getBaseDomain()).toBe('www.tradinggoose.ai')
    expect(getEmailDomain()).toBe('tradinggoose.ai')
  })

  it('rejects missing and invalid configured app urls outside email preview', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = undefined
    expect(() => getBaseDomain()).toThrow('NEXT_PUBLIC_APP_URL is required')

    mockEnv.NEXT_PUBLIC_APP_URL = 'app.tradinggoose.ai'
    expect(() => getBaseDomain()).toThrow('Configured base URL must be a valid URL')
  })
})
