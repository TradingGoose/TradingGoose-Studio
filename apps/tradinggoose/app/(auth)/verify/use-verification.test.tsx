/**
 * @vitest-environment jsdom
 */

import { act, useEffect } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { useVerification } from './use-verification'

const mockPush = vi.hoisted(() => vi.fn())
const mockRouter = vi.hoisted(() => ({ push: mockPush }))
const mockVerifyEmail = vi.hoisted(() => vi.fn())
const mockSendVerificationOtp = vi.hoisted(() => vi.fn())
const mockRefetchSession = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())
const testState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => testState.searchParams.get(key),
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => mockRouter,
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    emailOtp: {
      verifyEmail: mockVerifyEmail,
      sendVerificationOtp: mockSendVerificationOtp,
    },
  },
  useSession: () => ({
    refetch: mockRefetchSession,
  }),
}))

interface VerificationControls {
  handleOtpChange: (value: string) => void
  resendCode: () => void
  failureMessage: string
}

interface VerificationHarnessProps {
  locale: 'en' | 'es' | 'zh'
  hasEmailService?: boolean
  isEmailVerificationEnabled?: boolean
  onReady: (controls: VerificationControls) => void
}

function VerificationHarness({
  locale,
  hasEmailService = true,
  isEmailVerificationEnabled = true,
  onReady,
}: VerificationHarnessProps) {
  const controls = useVerification({
    hasEmailService,
    isEmailVerificationEnabled,
    copy: getPublicCopy(locale).auth.verify,
  })

  useEffect(() => {
    onReady(controls)
  }, [controls, onReady])

  return null
}

describe('useVerification', () => {
  let container: HTMLDivElement
  let root: Root
  let sessionStore: Map<string, string>
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    sessionStore = new Map<string, string>()

    const sessionStorageMock = {
      getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStore.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        sessionStore.delete(key)
      }),
      clear: vi.fn(() => {
        sessionStore.clear()
      }),
      key: vi.fn((index: number) => Array.from(sessionStore.keys())[index] ?? null),
      get length() {
        return sessionStore.size
      },
    }

    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: sessionStorageMock,
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: sessionStorageMock,
    })

    mockPush.mockReset()
    mockVerifyEmail.mockReset()
    mockSendVerificationOtp.mockReset()
    mockRefetchSession.mockReset()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    testState.searchParams = new URLSearchParams()
    window.history.replaceState({}, '', '/')
    global.fetch = mockFetch as typeof fetch
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderHarness(
    locale: 'en' | 'es' | 'zh',
    onReady: (controls: VerificationControls) => void,
    options: Pick<VerificationHarnessProps, 'hasEmailService' | 'isEmailVerificationEnabled'> = {}
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <VerificationHarness locale={locale} onReady={onReady} {...options} />
        </NextIntlClientProvider>
      )
    })
  }

  it('pushes the canonical workspace path after successful verification', async () => {
    sessionStore.set('verificationEmail', 'ada@example.com')
    mockVerifyEmail.mockResolvedValue({})
    mockRefetchSession.mockResolvedValue(undefined)

    let controls!: VerificationControls

    await renderHarness('zh', (value) => {
      controls = value
    })

    await act(async () => {
      controls.handleOtpChange('123456')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })

    expect(mockVerifyEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      otp: '123456',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/users/me/settings',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLocale: 'zh' }),
      })
    )
    expect(mockPush).toHaveBeenCalledWith('/workspace')
  })

  it.each([
    ['/workspace/ws-1/dashboard', '/workspace/ws-1/dashboard'],
    ['/invite/organization-invitation', '/invite/organization-invitation'],
    [
      '/invite/workspace-invitation?token=workspace-token#accept',
      '/invite/workspace-invitation?token=workspace-token#accept',
    ],
    ['/chat/chat-1?source=email#reply', '/chat/chat-1?source=email#reply'],
    [
      `${window.location.origin}/workspace/ws-1?tab=integrations#oauth`,
      '/workspace/ws-1?tab=integrations#oauth',
    ],
    ['https://external.example/secret', '/workspace'],
    ['//external.example/secret', '/workspace'],
  ])(
    'returns to safe redirectAfter %s after verification without an invitation flag',
    async (redirectAfter, destination) => {
      sessionStore.set('verificationEmail', 'ada@example.com')
      testState.searchParams.set('redirectAfter', redirectAfter)
      mockVerifyEmail.mockResolvedValue({})
      mockRefetchSession.mockResolvedValue(undefined)
      let controls!: VerificationControls
      await renderHarness('zh', (value) => {
        controls = value
      })
      await act(async () => controls.handleOtpChange('123456'))
      await act(async () => vi.advanceTimersByTimeAsync(1300))

      expect(mockPush).toHaveBeenCalledExactlyOnceWith(destination)
      expect(sessionStore.size).toBe(0)
    }
  )

  it('resends an email-verification OTP for the signup identity', async () => {
    sessionStore.set('verificationEmail', 'ADA@EXAMPLE.COM')
    mockSendVerificationOtp.mockResolvedValue({})
    let controls!: VerificationControls
    await renderHarness('en', (value) => {
      controls = value
    })

    await act(async () => controls.resendCode())

    expect(mockSendVerificationOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      type: 'email-verification',
    })
  })

  it.each([
    [{ code: 'OTP_EXPIRED' }, 'expired'],
    [{ code: 'INVALID_OTP' }, 'invalid'],
    [{ code: 'TOO_MANY_ATTEMPTS' }, 'attempts'],
    [{ status: 429 }, 'attempts'],
    [{ code: 'UNEXPECTED_ERROR' }, 'generic'],
  ] as const)('localizes returned verification failure %j', async (error, key) => {
    sessionStore.set('verificationEmail', 'ada@example.com')
    testState.searchParams.set('redirectAfter', '/chat/chat-1#reply')
    mockVerifyEmail.mockResolvedValue({ error })
    let controls!: VerificationControls
    await renderHarness('zh', (value) => {
      controls = value
    })

    await act(async () => controls.handleOtpChange('123456'))
    await act(async () => vi.advanceTimersByTimeAsync(300))

    expect(controls.failureMessage).toBe(getPublicCopy('zh').auth.verify.errors[key])
    expect(mockPush).not.toHaveBeenCalled()
    expect(sessionStore.get('verificationEmail')).toBe('ada@example.com')
  })

  it('reports a returned resend failure', async () => {
    sessionStore.set('verificationEmail', 'ada@example.com')
    mockSendVerificationOtp.mockResolvedValue({ error: { status: 429 } })
    let controls!: VerificationControls
    await renderHarness('en', (value) => {
      controls = value
    })

    await act(async () => controls.resendCode())

    expect(controls.failureMessage).toBe(getPublicCopy('en').auth.verify.errors.resendFailed)
  })

  it.each([
    [null, '/workspace'],
    ['/chat/chat-1?token=reply-token#reply', '/chat/chat-1?token=reply-token#reply'],
    ['//external.example/secret', '/workspace'],
  ])(
    'persists locale before a single verification-disabled redirect to %s',
    async (redirectAfter, destination) => {
      sessionStore.set('verificationEmail', 'ada@example.com')
      if (redirectAfter) testState.searchParams.set('redirectAfter', redirectAfter)
      mockRefetchSession.mockImplementation(async () => {
        expect(sessionStore.size).toBe(0)
      })
      const options = { hasEmailService: false, isEmailVerificationEnabled: false }
      await renderHarness('es', () => {}, options)
      await renderHarness('es', () => {}, options)

      expect(mockRefetchSession).toHaveBeenCalledOnce()
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/users/me/settings',
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          body: JSON.stringify({ preferredLocale: 'es' }),
        })
      )
      expect(mockFetch.mock.invocationCallOrder[0]).toBeLessThan(
        mockPush.mock.invocationCallOrder[0]
      )
      expect(mockPush).toHaveBeenCalledExactlyOnceWith(destination)
      expect(sessionStore.size).toBe(0)
    }
  )
})
