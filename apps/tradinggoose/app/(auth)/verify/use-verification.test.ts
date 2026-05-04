import { describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { getVerificationErrorMessage } from './use-verification'

const { mockUseRouter, mockUseSearchParams, mockUseSession } = vi.hoisted(() => {
  const mockUseRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }

  return {
    mockUseRouter,
    mockUseSearchParams: vi.fn(() => new URLSearchParams()),
    mockUseSession: vi.fn(() => ({ refetch: vi.fn() })),
  }
})

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter,
  useSearchParams: mockUseSearchParams,
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    emailOtp: {
      sendVerificationOtp: vi.fn(),
    },
    signIn: {
      emailOtp: vi.fn(),
    },
  },
  useSession: mockUseSession,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('getVerificationErrorMessage', () => {
  const copy = getPublicCopy('es').auth.verify

  it('returns the localized invalid verification message', () => {
    expect(getVerificationErrorMessage(copy, { message: 'invalid verification code' })).toBe(
      copy.errors.invalid
    )
  })

  it('returns the localized expired verification message', () => {
    expect(getVerificationErrorMessage(copy, new Error('verification expired'))).toBe(
      copy.errors.expired
    )
  })

  it('exposes the localized resend failure message from the catalog', () => {
    expect(copy.errors.resendFailed).toBe(
      'No se pudo reenviar el código de verificación. Vuelve a intentarlo más tarde.'
    )
  })
})
