'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { normalizeAuthErrorCode } from '@/lib/auth/auth-error-copy'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { normalizeCallbackUrl, type LocaleCode } from '@/i18n/utils'
import type { Messages } from 'next-intl'

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

export function getVerificationErrorMessage(copy: VerifyCopy, error: unknown) {
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
    return copy.errors.expired
  }
  if (normalizedErrorCode && VERIFICATION_ERROR_CODE_GROUPS.invalid.has(normalizedErrorCode)) {
    return copy.errors.invalid
  }
  if (normalizedErrorCode && VERIFICATION_ERROR_CODE_GROUPS.attempts.has(normalizedErrorCode)) {
    return copy.errors.attempts
  }

  return copy.errors.generic
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
  errorMessage: string
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
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isSendingInitialOtp, setIsSendingInitialOtp] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedEmail = sessionStorage.getItem('verificationEmail')
      if (storedEmail) {
        setEmail(storedEmail)
      }

      const storedRedirectUrl = sessionStorage.getItem('inviteRedirectUrl')
      if (storedRedirectUrl) {
        const normalizedRedirectUrl = normalizeCallbackUrl(
          storedRedirectUrl,
          window.location.origin
        )

        if (normalizedRedirectUrl) {
          setRedirectUrl(normalizedRedirectUrl)
        } else {
          logger.warn('Invalid stored verification redirect blocked', { url: storedRedirectUrl })
        }
      }

      const storedIsInviteFlow = sessionStorage.getItem('isInviteFlow')
      if (storedIsInviteFlow === 'true') {
        setIsInviteFlow(true)
      }
    }

    const redirectParam = searchParams.get('redirectAfter')
    if (redirectParam) {
      const normalizedRedirectUrl = normalizeCallbackUrl(
        redirectParam,
        typeof window !== 'undefined' ? window.location.origin : undefined
      )

      if (normalizedRedirectUrl) {
        setRedirectUrl(normalizedRedirectUrl)
      } else {
        logger.warn('Invalid verification redirect blocked', { url: redirectParam })
      }
    }

    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (email && !isSendingInitialOtp && hasEmailService) {
      setIsSendingInitialOtp(true)
    }
  }, [email, isSendingInitialOtp, hasEmailService])

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

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setErrorMessage('')

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const response = await client.signIn.emailOtp({
        email: normalizedEmail,
        otp,
      })

      if (response && !response.error) {
        setIsVerified(true)

        try {
          await refetchSession()
        } catch (e) {
          logger.warn('Failed to refetch session after verification', e)
        }

        await persistPreferredLocale()

        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('verificationEmail')

          if (isInviteFlow) {
            sessionStorage.removeItem('inviteRedirectUrl')
            sessionStorage.removeItem('isInviteFlow')
          }
        }

        setTimeout(() => {
          if (isInviteFlow && redirectUrl) {
            router.push(redirectUrl)
          } else {
            router.push('/workspace')
          }
        }, 1000)
      } else {
        logger.info('Setting invalid OTP state - API error response')
        const message = copy.errors.invalid
        setIsInvalidOtp(true)
        setErrorMessage(message)
        logger.info('Error state after API error:', {
          isInvalidOtp: true,
          errorMessage: message,
        })
        setOtp('')
      }
    } catch (error: unknown) {
      const message = getVerificationErrorMessage(copy, error)

      setIsInvalidOtp(true)
      setErrorMessage(message)
      logger.info('Error state after caught error:', {
        isInvalidOtp: true,
        errorMessage: message,
      })

      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  function resendCode() {
    if (!email || !hasEmailService || !isEmailVerificationEnabled) return

    setIsLoading(true)
    setErrorMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    client.emailOtp
      .sendVerificationOtp({
        email: normalizedEmail,
        type: 'sign-in',
      })
      .catch(() => {
        setErrorMessage(copy.errors.resendFailed)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  function handleOtpChange(value: string) {
    if (value.length === 6) {
      setIsInvalidOtp(false)
      setErrorMessage('')
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
    if (typeof window !== 'undefined') {
      if (!isEmailVerificationEnabled) {
        setIsVerified(true)

        const handleRedirect = async () => {
          try {
            await refetchSession()
          } catch (error) {
            logger.warn('Failed to refetch session during verification skip:', error)
          }

          await persistPreferredLocale()

          if (isInviteFlow && redirectUrl) {
            router.push(redirectUrl)
          } else {
            router.push('/workspace')
          }
        }

        handleRedirect()
      }
    }
  }, [isEmailVerificationEnabled, redirectUrl, router, isInviteFlow])

  return {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    errorMessage,
    isOtpComplete,
    hasEmailService,
    isProduction,
    isEmailVerificationEnabled,
    verifyCode,
    resendCode,
    handleOtpChange,
  }
}
