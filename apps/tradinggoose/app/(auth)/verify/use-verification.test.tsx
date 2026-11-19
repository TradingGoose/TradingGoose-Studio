/**
 * @vitest-environment jsdom
 */

import { act, useEffect } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPendingVerification, savePendingVerification } from '@/lib/auth/redirect-urls'
import { getPublicCopy } from '@/i18n/public-copy'
import { useVerification } from './use-verification'

const mockPush = vi.hoisted(() => vi.fn())
const mockRouter = vi.hoisted(() => ({ push: mockPush }))
const mockResetPasswordOtp = vi.hoisted(() => vi.fn())
const mockSendVerificationEmail = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())
const testState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => testState.searchParams,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => mockRouter,
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signIn: { email: vi.fn().mockResolvedValue({ error: null }) },
    sendVerificationEmail: mockSendVerificationEmail,
    emailOtp: {
      resetPassword: mockResetPasswordOtp,
    },
  },
}))

type VerificationControls = ReturnType<typeof useVerification>

interface VerificationHarnessProps {
  hasEmailService?: boolean
  isEmailVerificationEnabled?: boolean
  onReady: (controls: VerificationControls) => void
}

function VerificationHarness({
  hasEmailService = true,
  isEmailVerificationEnabled = true,
  onReady,
}: VerificationHarnessProps) {
  const controls = useVerification({
    hasEmailService,
    isEmailVerificationEnabled,
  })

  useEffect(() => {
    onReady(controls)
  }, [controls, onReady])

  return null
}

describe('useVerification', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const stored = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
      removeItem: (key: string) => stored.delete(key),
    })
    mockPush.mockReset()
    mockResetPasswordOtp.mockReset()
    mockSendVerificationEmail.mockReset()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    testState.searchParams = new URLSearchParams()
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function renderHarness(
    locale: 'en' | 'es' | 'zh',
    onReady: (controls: VerificationControls) => void,
    options: Pick<VerificationHarnessProps, 'hasEmailService' | 'isEmailVerificationEnabled'> = {}
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <VerificationHarness onReady={onReady} {...options} />
        </NextIntlClientProvider>
      )
    })
  }

  it('pushes the canonical workspace path after successful verification', async () => {
    savePendingVerification('ada@example.com', '/verify')
    mockResetPasswordOtp.mockResolvedValue({})

    let controls!: VerificationControls

    await renderHarness('zh', (value) => {
      controls = value
    })

    await act(async () => {
      controls.handleOtpChange('123456')
    })

    await act(async () => controls.verifyCode('        '))
    expect(controls.failureMessage).toBe(getPublicCopy('zh').auth.login.validation.passwordEmpty)
    expect(mockResetPasswordOtp).not.toHaveBeenCalled()

    await act(async () => {
      await controls.verifyCode(' ChosenPassword1! ')
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(mockResetPasswordOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      otp: '123456',
      password: ' ChosenPassword1! ',
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
      savePendingVerification('ada@example.com', '/verify')
      testState.searchParams.set('redirectAfter', redirectAfter)
      mockResetPasswordOtp.mockResolvedValue({})
      let controls!: VerificationControls
      await renderHarness('zh', (value) => {
        controls = value
      })
      await act(async () => controls.handleOtpChange('123456'))
      await act(async () => controls.verifyCode('ChosenPassword1!'))
      await act(async () => vi.advanceTimersByTimeAsync(1000))

      expect(mockPush).toHaveBeenCalledExactlyOnceWith(destination)
      expect(getPendingVerification()).toBeNull()
    }
  )

  it('requests verification again for the signup identity', async () => {
    savePendingVerification('ADA@EXAMPLE.COM', '/verify')
    mockSendVerificationEmail.mockResolvedValue({})
    let controls!: VerificationControls
    await renderHarness('en', (value) => {
      controls = value
    })

    await act(async () => controls.resendCode())

    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
    })
  })

  it.each([
    [{ code: 'OTP_EXPIRED' }, 'expired'],
    [{ code: 'INVALID_OTP' }, 'invalid'],
    [{ code: 'TOO_MANY_ATTEMPTS' }, 'attempts'],
    [{ status: 429 }, 'attempts'],
    [{ code: 'UNEXPECTED_ERROR' }, 'generic'],
  ] as const)('localizes returned verification failure %j', async (error, key) => {
    savePendingVerification('ada@example.com', '/verify')
    testState.searchParams.set('redirectAfter', '/chat/chat-1#reply')
    mockResetPasswordOtp.mockResolvedValue({ error })
    let controls!: VerificationControls
    await renderHarness('zh', (value) => {
      controls = value
    })

    await act(async () => controls.handleOtpChange('123456'))
    await act(async () => controls.verifyCode('ChosenPassword1!'))

    expect(controls.failureMessage).toBe(getPublicCopy('zh').auth.verify.errors[key])
    expect(mockPush).not.toHaveBeenCalled()
    expect(getPendingVerification()?.email).toBe('ada@example.com')
  })

  it('reports a returned resend failure', async () => {
    savePendingVerification('ada@example.com', '/verify')
    mockSendVerificationEmail.mockResolvedValue({ error: { status: 429 } })
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
      savePendingVerification('ada@example.com', '/verify')
      if (redirectAfter) testState.searchParams.set('redirectAfter', redirectAfter)
      const options = { hasEmailService: false, isEmailVerificationEnabled: false }
      await renderHarness('es', () => {}, options)
      await renderHarness('es', () => {}, options)

      expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
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
      expect(getPendingVerification()).toBeNull()
    }
  )
})
