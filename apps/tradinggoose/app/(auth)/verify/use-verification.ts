'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useRouter } from '@/i18n/navigation'
import { type PublicCopy } from '@/i18n/public-copy'
import { localizeHref, type LocaleCode } from '@/i18n/utils'

const logger = createLogger('useVerification')
type VerifyCopy = PublicCopy['auth']['verify']

export function getVerificationErrorMessage(copy: VerifyCopy, error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''

  if (message.includes('expired')) return copy.errors.expired
  if (message.includes('invalid')) return copy.errors.invalid
  if (message.includes('attempts')) return copy.errors.attempts

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
        setRedirectUrl(storedRedirectUrl)
      }

      const storedIsInviteFlow = sessionStorage.getItem('isInviteFlow')
      if (storedIsInviteFlow === 'true') {
        setIsInviteFlow(true)
      }
    }

    const redirectParam = searchParams.get('redirectAfter')
    if (redirectParam) {
      setRedirectUrl(redirectParam)
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

        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('verificationEmail')

          if (isInviteFlow) {
            sessionStorage.removeItem('inviteRedirectUrl')
            sessionStorage.removeItem('isInviteFlow')
          }
        }

        setTimeout(() => {
          if (isInviteFlow && redirectUrl) {
            window.location.href = redirectUrl
          } else {
            router.push(localizeHref(locale, '/workspace'))
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

          if (isInviteFlow && redirectUrl) {
            window.location.href = redirectUrl
          } else {
            router.push(localizeHref(locale, '/workspace'))
          }
        }

        handleRedirect()
      }
    }
  }, [isEmailVerificationEnabled, router, isInviteFlow, redirectUrl])

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
