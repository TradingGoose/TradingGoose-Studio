import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockI18nMiddleware } = vi.hoisted(() => ({
  mockI18nMiddleware: vi.fn(() => new Response('ok')),
}))

vi.mock('fumadocs-core/i18n/middleware', () => ({
  createI18nMiddleware: vi.fn(() => mockI18nMiddleware),
}))

describe('docs proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rewrites the public zh path to the internal zh-CN locale segment', async () => {
    const { proxy } = await import('./proxy')
    const response = proxy(new NextRequest('https://docs.tradinggoose.ai/zh/getting-started'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://docs.tradinggoose.ai/zh-CN/getting-started'
    )
    expect(mockI18nMiddleware).not.toHaveBeenCalled()
  })

  it('rejects the old zh-CN public prefix', async () => {
    const { proxy } = await import('./proxy')
    const response = proxy(new NextRequest('https://docs.tradinggoose.ai/zh-CN/getting-started'))

    expect(response.status).toBe(404)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
