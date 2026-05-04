/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { VerifyContent } from './verify-content'

const { useLocaleMock, useRouterPushMock, useVerificationMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'es'),
  useRouterPushMock: vi.fn(),
  useVerificationMock: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: useRouterPushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/app/(auth)/verify/use-verification', () => ({
  useVerification: useVerificationMock,
}))

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: '' },
}))

vi.mock('@/app/fonts/soehne/soehne', () => ({
  soehne: { className: '' },
}))

vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  InputOTPGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  InputOTPSlot: () => <div />,
}))

describe('VerifyContent', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders localized verification copy and resend/back actions', async () => {
    const copy = getPublicCopy('es')
    const resendCode = vi.fn()

    useVerificationMock.mockReturnValue({
      otp: '',
      email: 'user@example.com',
      isLoading: false,
      isVerified: false,
      isInvalidOtp: false,
      errorMessage: '',
      isOtpComplete: false,
      hasEmailService: true,
      isProduction: false,
      isEmailVerificationEnabled: true,
      verifyCode: vi.fn(),
      resendCode,
      handleOtpChange: vi.fn(),
    })

    await act(async () => {
      root.render(
        <VerifyContent
          hasEmailService
          isProduction={false}
          isEmailVerificationEnabled
        />
      )
    })

    expect(container.querySelector('p.uppercase')?.textContent).toBe(copy.auth.verify.eyebrow)
    expect(container.querySelector('h1')?.textContent).toBe(copy.auth.verify.pendingTitle)
    expect(container.querySelector('div.space-y-6 p')?.textContent).toBe(
      'Introduce el código de 6 dígitos para verificar tu cuenta. Si no lo ves en tu bandeja de entrada, revisa la carpeta de spam.'
    )
    expect(container.textContent).toContain(copy.auth.verify.instructionsWithService)
    expect(container.textContent).toContain(copy.auth.verify.verifyButton)
    expect(container.textContent).toContain(copy.auth.verify.resendPrompt)
    expect(container.textContent).toContain(copy.auth.common.backToSignup)

    const resendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === copy.auth.verify.resendButton
    )
    expect(resendButton).toBeTruthy()

    await act(async () => {
      resendButton?.click()
    })

    expect(resendCode).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Reenviar en 30s')
  })

  it('renders the translated verified header state', async () => {
    const copy = getPublicCopy('es')

    useVerificationMock.mockReturnValue({
      otp: '',
      email: 'user@example.com',
      isLoading: false,
      isVerified: true,
      isInvalidOtp: false,
      errorMessage: '',
      isOtpComplete: false,
      hasEmailService: true,
      isProduction: false,
      isEmailVerificationEnabled: true,
      verifyCode: vi.fn(),
      resendCode: vi.fn(),
      handleOtpChange: vi.fn(),
    })

    await act(async () => {
      root.render(
        <VerifyContent
          hasEmailService
          isProduction={false}
          isEmailVerificationEnabled
        />
      )
    })

    expect(container.querySelector('h1')?.textContent).toBe(copy.auth.verify.verifiedTitle)
    expect(container.textContent).toContain(copy.auth.verify.verifiedDescription)
  })
})
