import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeCallbackUrl } from '@/i18n/utils'

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

    const { handleAuthError } = await import('./auth-error-handler')

    await handleAuthError('socket-auth', '/login')

    expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fworkspace&reauth=1#credentials')
  })

  it('preserves the Robinhood helper return URL through login normalization', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const destination = '/workspace/team/integrations?tab=trading#accounts'
    const returnURL = `/connect/robinhood/authorize?callbackURL=${encodeURIComponent(destination)}`
    stubWindow(`https://studio.example.test/es${returnURL}`)
    const { handleAuthError } = await import('./auth-error-handler')

    await handleAuthError('robinhood-connect', '/connect/robinhood/authorize')

    const loginURL = new URL(replaceMock.mock.calls[0][0], 'https://studio.example.test')
    expect(loginURL.pathname).toBe('/login')
    expect(loginURL.searchParams.get('reauth')).toBe('1')
    expect(normalizeCallbackUrl(loginURL.searchParams.get('callbackUrl'))).toBe(returnURL)
  })
})
