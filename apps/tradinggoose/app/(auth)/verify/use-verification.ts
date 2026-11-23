'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Messages } from 'next-intl'
import { useLocale } from 'next-intl'
import { normalizeAuthErrorCode } from '@/lib/auth/auth-error-copy'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useRouter } from '@/i18n/navigation'
import { type LocaleCode, normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('useVerification')
type VerifyCopy = Messages['auth']['verify']

const VERIFICATION_ERROR_CODE_GROUPS = {
  expired: new Set([
    'TOKEN_EXPIRED',
    'EXPIRED_TOKEN',
    'VERIFICATION_CODE_EXPIRED',
    'EXPIRED_VERIFICATION_CODE',
    'OTP_EXPIRED',
    'CODE_EXPIRED',
  ]),
  invalid: new Set([
    'INVALID_TOKEN',
    'INVALID_VERIFICATION_CODE',
    'INVALID_OTP',
    'OTP_INVALID',
    'INVALID_CODE',
  ]),
  attempts: new Set([
    'TOO_MANY_ATTEMPTS',
    'TOO_MANY_FAILED_ATTEMPTS',
    'MAX_ATTEMPTS_EXCEEDED',
    'OTP_TOO_MANY_ATTEMPTS',
    'RATE_LIMIT',
  ]),
} as const

export function resolveVerificationFailureMessage(copy: VerifyCopy, error: unknown) {
  const { errors: failureCopy } = copy
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''

  const normalizedErrorCode = normalizeAuthErrorCode(code) ?? normalizeAuthErrorCode(message)
  if (normalizedErrorCode && VERIFICATION_ERROR_CODE_GROUPS.expired.has(normalizedErrorCode)) {
    return failureCopy.expired
  }
  if (normalizedErrorCode && VERIFICATION_ERROR_CODE_GROUPS.invalid.has(normalizedErrorCode)) {
    return failureCopy.invalid
  }
  if (normalizedErrorCode && VERIFICATION_ERROR_CODE_GROUPS.attempts.has(normalizedErrorCode)) {
    return failureCopy.attempts
  }

  return failureCopy.generic
}

interface UseVerificationParams {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
  copy: VerifyCopy
}

interface UseVerificationReturn {
  otp: string
  email: string
  isLoading: boolean
  isVerified: boolean
  isInvalidOtp: boolean
  failureMessage: string
  isOtpComplete: boolean
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
  verifyCode: () => Promise<void>
  resendCode: () => void
  handleOtpChange: (value: string) => void
}

export function useVerification({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
  copy,
}: UseVerificationParams): UseVerificationReturn {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const { errors: failureCopy } = copy
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')
  const destination = normalizeCallbackUrl(searchParams.get('redirectAfter')) ?? '/workspace'

  useEffect(() => {
    setEmail(sessionStorage.getItem('verificationEmail') ?? '')
  }, [])

  const isOtpComplete = otp.length === 6

  async function persistPreferredLocale() {
    try {
      const response = await fetch('/api/users/me/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLocale: locale }),
      })

      if (!response.ok) {
        throw new Error('Failed to persist preferred locale after verification')
      }
    } catch (error) {
      logger.warn('Failed to persist preferred locale after verification', { error, locale })
    }
  }

  async function finishVerification() {
    const session = await client.getSession()
    if (
      !session.data?.user ||
      (email && session.data.user.email.toLowerCase() !== email.toLowerCase())
    ) {
      router.push(`/login?callbackUrl=${encodeURIComponent(destination)}`)
      return
    }
    setIsVerified(true)
    await refetchSession()
    await persistPreferredLocale()
    sessionStorage.removeItem('verificationEmail')
    router.push(destination)
  }

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setFailureMessage('')

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { error } = await client.emailOtp.verifyEmail({ email: normalizedEmail, otp })
      if (error) throw error
      setOtp('')
      await finishVerification()
    } catch (error: unknown) {
      const message = resolveVerificationFailureMessage(copy, error)

      setIsInvalidOtp(true)
      setFailureMessage(message)
      logger.info('Error state after caught error:', {
        isInvalidOtp: true,
        failureMessage: message,
      })

      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  function resendCode() {
    if (!email || !hasEmailService || !isEmailVerificationEnabled) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setFailureMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    client.emailOtp
      .sendVerificationOtp({
        email: normalizedEmail,
        type: 'email-verification',
      })
      .then(({ error }) => {
        if (error) setFailureMessage(failureCopy.resendFailed)
      })
      .catch(() => {
        setFailureMessage(failureCopy.resendFailed)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  function handleOtpChange(value: string) {
    if (value.length === 6) {
      setIsInvalidOtp(false)
      setFailureMessage('')
    }
    setOtp(value)
  }

  useEffect(() => {
    if (otp.length === 6 && email && !isLoading && !isVerified) {
      const timeoutId = setTimeout(() => {
        verifyCode()
      }, 300)

      return () => clearTimeout(timeoutId)
    }
  }, [otp, email, isLoading, isVerified])

  useEffect(() => {
    if (!isEmailVerificationEnabled) {
      void finishVerification().catch(() =>
        router.push(`/login?callbackUrl=${encodeURIComponent(destination)}`)
      )
    }
  }, [isEmailVerificationEnabled, destination])

  return {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    failureMessage,
    isOtpComplete,
    hasEmailService,
    isProduction,
    isEmailVerificationEnabled,
    verifyCode,
    resendCode,
    handleOtpChange,
  }
}
