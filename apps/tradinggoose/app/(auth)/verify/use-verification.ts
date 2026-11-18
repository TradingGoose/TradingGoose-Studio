'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Messages } from 'next-intl'
import { useLocale } from 'next-intl'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useRouter } from '@/i18n/navigation'
import { type LocaleCode, normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('useVerification')
type VerifyCopy = Messages['auth']['verify']

function resolveVerificationFailureMessage(copy: VerifyCopy, error: unknown) {
  const { errors: failureCopy } = copy
  if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
    return failureCopy.attempts
  }
  switch (error && typeof error === 'object' && 'code' in error ? error.code : null) {
    case 'OTP_EXPIRED':
      return failureCopy.expired
    case 'INVALID_OTP':
      return failureCopy.invalid
    case 'TOO_MANY_ATTEMPTS':
      return failureCopy.attempts
    default:
      return failureCopy.generic
  }
}

interface UseVerificationParams {
  hasEmailService: boolean
  isEmailVerificationEnabled: boolean
  copy: VerifyCopy
}

export function useVerification({
  hasEmailService,
  isEmailVerificationEnabled,
  copy,
}: UseVerificationParams) {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const redirectAfter = useSearchParams().get('redirectAfter')
  const destination =
    normalizeCallbackUrl(
      redirectAfter,
      typeof window !== 'undefined' ? window.location.origin : undefined
    ) ?? '/workspace'
  const { refetch: refetchSession } = useSession()
  const { errors: failureCopy } = copy
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')

  useEffect(() => {
    const storedEmail = sessionStorage.getItem('verificationEmail')
    if (storedEmail) {
      setEmail(storedEmail)
    }
  }, [])

  const isOtpComplete = otp.length === 6

  async function refreshSessionAndPersistLocale() {
    try {
      await refetchSession()
    } catch (error) {
      logger.warn('Failed to refetch session after verification', error)
    }

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
    setFailureMessage('')

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { error } = await client.emailOtp.verifyEmail({
        email: normalizedEmail,
        otp,
      })

      if (error) throw error
      setIsVerified(true)

      await refreshSessionAndPersistLocale()

      sessionStorage.removeItem('verificationEmail')

      setTimeout(() => {
        router.push(destination)
      }, 1000)
    } catch (error: unknown) {
      setIsInvalidOtp(true)
      setFailureMessage(resolveVerificationFailureMessage(copy, error))
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
        if (error) throw error
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
    if (isEmailVerificationEnabled) return

    setIsVerified(true)
    sessionStorage.removeItem('verificationEmail')

    void refreshSessionAndPersistLocale().then(() => {
      router.push(destination)
    })
  }, [isEmailVerificationEnabled, destination, router])

  return {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    failureMessage,
    isOtpComplete,
    verifyCode,
    resendCode,
    handleOtpChange,
  }
}
