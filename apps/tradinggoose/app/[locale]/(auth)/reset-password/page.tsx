'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { SetNewPasswordForm } from '@/app/(auth)/reset-password/reset-password-form'
import { inter } from '@/app/fonts/inter'
import { Link, useRouter } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('ResetPasswordPage')

type ResetPasswordResult = {
  type: 'success' | 'error'
  message: string
}

function ResetPasswordContent() {
  const router = useRouter()
  const copy = useMessages()
  const resetCopy = copy.auth.resetPassword
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const loginParams = new URLSearchParams()
  const destination = normalizeCallbackUrl(searchParams.get('callbackUrl'))
  if (destination) loginParams.set('callbackUrl', destination)
  if (searchParams.get('invite_flow') === 'true') loginParams.set('invite_flow', 'true')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resetResult, setResetResult] = useState<ResetPasswordResult | null>(null)

  const handleResetPassword = async (password: string) => {
    if (!token) return
    try {
      setIsSubmitting(true)
      setResetResult(null)

      const { error } = await client.resetPassword({
        token,
        newPassword: password,
      })
      if (error) {
        throw new Error(error.message || resetCopy.failure)
      }

      setResetResult({
        type: 'success',
        message: resetCopy.success,
      })

      loginParams.set('resetSuccess', 'true')
      setTimeout(() => router.push(`/login?${loginParams}`), 1500)
    } catch (error) {
      logger.error('Error resetting password:', { error })
      setResetResult({
        type: 'error',
        message: error instanceof Error ? error.message : resetCopy.failure,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <AuthPageHeader
        eyebrow={resetCopy.eyebrow}
        title={resetCopy.title}
        description={resetCopy.description}
      />

      <div className={`${inter.className} mt-8`}>
        <SetNewPasswordForm
          token={token}
          onSubmit={handleResetPassword}
          isSubmitting={isSubmitting}
          result={token ? resetResult : { type: 'error', message: resetCopy.invalidToken }}
        />
      </div>

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <Link
          href={loginParams.size ? `/login?${loginParams}` : '/login'}
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          {resetCopy.backToLogin}
        </Link>
      </div>
    </>
  )
}

function ResetPasswordLoadingFallback() {
  const copy = useMessages()

  return <div className='flex h-screen items-center justify-center'>{copy.auth.common.loading}</div>
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordLoadingFallback />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
