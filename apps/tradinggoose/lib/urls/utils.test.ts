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
    delete process.env.EMAILS_DIR_ABSOLUTE_PATH
    delete process.env.PREVIEW_SERVER_LOCATION
  })

  it('uses NEXT_PUBLIC_APP_URL as the base URL', () => {
    expect(getBaseUrl()).toBe('https://www.tradinggoose.ai')
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

  it('uses the documented email preview fallback when app url is unavailable there', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = undefined
    mockEnv.EMAILS_PREVIEW_BASE_URL = 'http://127.0.0.1:3000'
    process.env.EMAILS_DIR_ABSOLUTE_PATH = '/tmp/emails'

    expect(getBaseUrl()).toBe('http://127.0.0.1:3000')
  })

  it('defaults email preview to localhost when no preview base url is provided', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = undefined
    process.env.PREVIEW_SERVER_LOCATION = '/tmp/preview-server'

    expect(getBaseUrl()).toBe('http://localhost:3000')
  })

  it('rejects missing and invalid configured app urls outside email preview', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = undefined
    expect(() => getBaseDomain()).toThrow('NEXT_PUBLIC_APP_URL is required')

    mockEnv.NEXT_PUBLIC_APP_URL = 'app.tradinggoose.ai'
    expect(() => getBaseDomain()).toThrow('Configured base URL must be a valid URL')
  })

  it('rejects invalid email preview base urls', () => {
    mockEnv.NEXT_PUBLIC_APP_URL = undefined
    mockEnv.EMAILS_PREVIEW_BASE_URL = 'preview.tradinggoose.ai'
    process.env.EMAILS_DIR_ABSOLUTE_PATH = '/tmp/emails'

    expect(() => getBaseUrl()).toThrow('Configured base URL must be a valid URL')
  })
})
