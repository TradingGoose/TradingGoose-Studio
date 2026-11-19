'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Messages } from 'next-intl'
import { useLocale, useMessages } from 'next-intl'
import { getSignupPasswordError } from '@/lib/auth/auth-error-copy'
import { client } from '@/lib/auth-client'
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
}

export function useVerification({
  hasEmailService,
  isEmailVerificationEnabled,
}: UseVerificationParams) {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const searchParams = useSearchParams()
  const fromSignup = searchParams.get('fromSignup') === 'true'
  const isInviteFlow = searchParams.get('invite_flow') === 'true'
  const destination =
    normalizeCallbackUrl(
      searchParams.get('redirectAfter'),
      typeof window !== 'undefined' ? window.location.origin : undefined
    ) ?? '/workspace'
  const returnQuery = `?callbackUrl=${encodeURIComponent(destination)}${isInviteFlow ? '&invite_flow=true' : ''}`
  const { verify: copy, signup } = useMessages().auth
  const { errors: failureCopy } = copy
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [failure, setFailure] = useState<{ message: string; invalidOtp?: boolean }>()

  useEffect(() => {
    setEmail(sessionStorage.getItem('verificationEmail')?.trim().toLowerCase() ?? '')
  }, [])

  const isOtpComplete = otp.length === 6

  async function persistLocale() {
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

  async function verifyCode(password: string) {
    if (!isOtpComplete || !email || !password) return
    if (fromSignup) {
      const passwordError = getSignupPasswordError(signup.validation, password)
      if (passwordError) {
        setFailure({ message: passwordError })
        return
      }
    }

    setIsLoading(true)
    setFailure(undefined)

    try {
      const { error } = await client.emailOtp.resetPassword({ email, otp, password })
      if (error) throw error
      sessionStorage.removeItem('verificationEmail')
      setIsVerified(true)

      const signedIn = await client.signIn.email({ email, password }).catch(() => null)
      if (!signedIn || signedIn.error) {
        router.push(`/login${returnQuery}`)
        return
      }

      await persistLocale()
      setTimeout(() => router.push(destination), 1000)
    } catch (error: unknown) {
      setFailure({ message: resolveVerificationFailureMessage(copy, error), invalidOtp: true })
      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  async function resendCode() {
    if (!email || !hasEmailService || !isEmailVerificationEnabled) return

    setIsLoading(true)
    setFailure(undefined)

    try {
      const { error } = await client.emailOtp.requestPasswordReset({ email })
      if (error) throw error
    } catch {
      setFailure({ message: failureCopy.resendFailed })
    } finally {
      setIsLoading(false)
    }
  }

  function handleOtpChange(value: string) {
    if (value.length === 6) setFailure(undefined)
    setOtp(value)
  }

  function returnToAuth() {
    const path = fromSignup ? '/signup' : '/login'
    sessionStorage.removeItem('verificationEmail')
    router.push(`${path}${returnQuery}`)
  }

  useEffect(() => {
    if (isEmailVerificationEnabled) return

    setIsVerified(true)
    sessionStorage.removeItem('verificationEmail')

    void persistLocale().then(() => {
      router.push(destination)
    })
  }, [isEmailVerificationEnabled, destination, router])

  return {
    fromSignup,
    returnToAuth,
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp: !!failure?.invalidOtp,
    failureMessage: failure?.message,
    isOtpComplete,
    verifyCode,
    resendCode,
    handleOtpChange,
  }
}
