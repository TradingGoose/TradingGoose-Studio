/**
 * @vitest-environment jsdom
 */

import { act, useEffect } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import * as i18nUtils from '@/i18n/utils'
import { useVerification } from './use-verification'

const mockPush = vi.hoisted(() => vi.fn())
const mockEmailOtpSignIn = vi.hoisted(() => vi.fn())
const mockSendVerificationOtp = vi.hoisted(() => vi.fn())
const mockRefetchSession = vi.hoisted(() => vi.fn())
const testState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => testState.searchParams.get(key),
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signIn: {
      emailOtp: mockEmailOtpSignIn,
    },
    emailOtp: {
      sendVerificationOtp: mockSendVerificationOtp,
    },
  },
  useSession: () => ({
    refetch: mockRefetchSession,
  }),
}))

interface VerificationHarnessProps {
  locale: 'en' | 'es' | 'zh-CN'
  hasEmailService?: boolean
  isProduction?: boolean
  isEmailVerificationEnabled?: boolean
  onReady: (controls: ReturnType<typeof useVerification>) => void
}

function VerificationHarness({
  locale,
  hasEmailService = true,
  isProduction = false,
  isEmailVerificationEnabled = true,
  onReady,
}: VerificationHarnessProps) {
  const controls = useVerification({
    hasEmailService,
    isProduction,
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
    mockEmailOtpSignIn.mockReset()
    mockSendVerificationOtp.mockReset()
    mockRefetchSession.mockReset()
    testState.searchParams = new URLSearchParams()
    window.history.replaceState({}, '', '/')
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
    locale: 'en' | 'es' | 'zh-CN',
    onReady: (controls: ReturnType<typeof useVerification>) => void
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <VerificationHarness locale={locale} onReady={onReady} />
        </NextIntlClientProvider>
      )
    })
  }

  it('pushes the canonical workspace path after successful verification', async () => {
    sessionStore.set('verificationEmail', 'ada@example.com')
    mockEmailOtpSignIn.mockResolvedValue({})
    mockRefetchSession.mockResolvedValue(undefined)

    let controls: ReturnType<typeof useVerification> | null = null

    await renderHarness('zh-CN', (value) => {
      controls = value
    })

    if (!controls) {
      throw new Error('Expected verification controls to initialize')
    }

    await act(async () => {
      controls.handleOtpChange('123456')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })

    expect(mockEmailOtpSignIn).toHaveBeenCalledWith({
      email: 'ada@example.com',
      otp: '123456',
    })
    expect(mockPush).toHaveBeenCalledWith('/workspace')
  })

  it('keeps browser-level invite redirects locale-aware via localizeHref', async () => {
    sessionStore.set('verificationEmail', 'ada@example.com')
    sessionStore.set('inviteRedirectUrl', '/workspace/ws-1/dashboard')
    sessionStore.set('isInviteFlow', 'true')
    mockEmailOtpSignIn.mockResolvedValue({})
    mockRefetchSession.mockResolvedValue(undefined)
    const localizeHrefSpy = vi
      .spyOn(i18nUtils, 'localizeHref')
      .mockReturnValue('#invite-redirect')

    let controls: ReturnType<typeof useVerification> | null = null

    await renderHarness('zh-CN', (value) => {
      controls = value
    })

    if (!controls) {
      throw new Error('Expected verification controls to initialize')
    }

    await act(async () => {
      controls.handleOtpChange('123456')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })

    expect(mockPush).not.toHaveBeenCalled()
    expect(localizeHrefSpy).toHaveBeenCalledWith('zh-CN', '/workspace/ws-1/dashboard')
    expect(window.location.hash).toBe('#invite-redirect')
  })
})
