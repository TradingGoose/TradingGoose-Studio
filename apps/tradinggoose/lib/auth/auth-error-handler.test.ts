import { afterEach, describe, expect, it, vi } from 'vitest'

const replaceMock = vi.fn()

function stubWindow(url: string) {
  const parsedUrl = new URL(url)

  vi.stubGlobal('window', {
    location: {
      href: parsedUrl.href,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      hash: parsedUrl.hash,
      replace: replaceMock,
    },
    sessionStorage: {
      getItem: vi.fn(() => '0'),
      setItem: vi.fn(),
    },
  })
}

describe('handleAuthError', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes login-page auth recovery through login reauth cleanup', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    stubWindow('https://app.tradinggoose.ai/login?callbackUrl=%2Fworkspace#credentials')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))

    const { handleAuthError } = await import('./auth-error-handler')

    await handleAuthError('login-unauthorized', '/login')

    expect(replaceMock).toHaveBeenCalledWith(
      '/login?callbackUrl=%2Fworkspace&reauth=1#credentials'
    )
  })
})
