'use client'

import { Suspense, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { Link, useRouter } from '@/i18n/navigation'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { SetNewPasswordForm } from '@/app/(auth)/reset-password/reset-password-form'
import { useAppMessages } from '@/i18n/client-messages'
import { localizeHref, type LocaleCode } from '@/i18n/utils'
import { inter } from '@/app/fonts/inter'

const logger = createLogger('ResetPasswordPage')

function ResetPasswordContent() {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages()
  const resetCopy = copy.auth.resetPassword
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | null
    text: string
  }>({
    type: null,
    text: '',
  })

  useEffect(() => {
    if (!token) {
      setStatusMessage({
        type: 'error',
        text: resetCopy.invalidToken,
      })
    }
  }, [resetCopy.invalidToken, token])

  const handleResetPassword = async (password: string) => {
    try {
      setIsSubmitting(true)
      setStatusMessage({ type: null, text: '' })

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword: password,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || resetCopy.failure)
      }

      setStatusMessage({
        type: 'success',
        text: resetCopy.success,
      })

      setTimeout(() => {
        router.push(localizeHref(locale, '/login?resetSuccess=true'))
      }, 1500)
    } catch (error) {
      logger.error('Error resetting password:', { error })
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : resetCopy.failure,
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
          statusType={statusMessage.type}
          statusMessage={statusMessage.text}
        />
      </div>

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <Link
          href='/login'
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          {resetCopy.backToLogin}
        </Link>
      </div>
    </>
  )
}

function ResetPasswordLoadingFallback() {
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages()

  return <div className='flex h-screen items-center justify-center'>{copy.auth.common.loading}</div>
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordLoadingFallback />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
