'use client'

import { Suspense, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'
import { useRouter } from '@/i18n/navigation'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { useVerification } from '@/app/(auth)/verify/use-verification'
import { inter } from '@/app/fonts/inter'

interface VerifyContentProps {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}

function VerificationForm({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}) {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)
  const verifyCopy = copy.auth.verify
  const commonCopy = copy.auth.common
  const {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    errorMessage,
    isOtpComplete,
    verifyCode,
    resendCode,
    handleOtpChange,
  } = useVerification({
    hasEmailService,
    isProduction,
    isEmailVerificationEnabled,
    copy: verifyCopy,
  })

  const [countdown, setCountdown] = useState(0)
  const [isResendDisabled, setIsResendDisabled] = useState(false)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
    if (countdown === 0 && isResendDisabled) {
      setIsResendDisabled(false)
    }
  }, [countdown, isResendDisabled])

  const router = useRouter()

  const handleResend = () => {
    resendCode()
    setIsResendDisabled(true)
    setCountdown(30)
  }

  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  return (
    <>
      <AuthPageHeader
        eyebrow={verifyCopy.eyebrow}
        title={isVerified ? verifyCopy.verifiedTitle : verifyCopy.pendingTitle}
        description={
          isVerified
            ? verifyCopy.verifiedDescription
            : !isEmailVerificationEnabled
              ? verifyCopy.disabledDescription
              : hasEmailService
                ? formatTemplate(verifyCopy.codeSent, {
                    email: email || verifyCopy.yourEmail,
                  })
                : !isProduction
                  ? verifyCopy.developmentDescription
                  : verifyCopy.missingServiceDescription
        }
      />

      {!isVerified && isEmailVerificationEnabled && (
        <div className={`${inter.className} mt-8 space-y-8`}>
          <div className='space-y-6'>
            <p className='text-center text-muted-foreground text-sm'>
              {hasEmailService
                ? verifyCopy.instructionsWithService
                : verifyCopy.instructionsWithoutService}
            </p>

            <div className='flex justify-center'>
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={isLoading}
                className={cn('gap-2', isInvalidOtp && 'otp-error')}
              >
                <InputOTPGroup className='[&>div]:!rounded-md gap-2'>
                  <InputOTPSlot
                    index={0}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={1}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={2}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={3}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={4}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={5}
                    className={cn(
                      '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                <p>{errorMessage}</p>
              </div>
            )}
          </div>

          <Button
            onClick={verifyCode}
            className={primaryButtonClasses}
            disabled={!isOtpComplete || isLoading}
          >
            {isLoading ? verifyCopy.verifyingButton : verifyCopy.verifyButton}
          </Button>

          {hasEmailService && (
            <div className='text-center'>
              <p className='text-muted-foreground text-sm'>
                {verifyCopy.resendPrompt}{' '}
                {countdown > 0 ? (
                  <span>
                    {formatTemplate(verifyCopy.resendIn, {
                      countdown,
                    })}
                  </span>
                ) : (
                  <button
                    className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
                    onClick={handleResend}
                    disabled={isLoading || isResendDisabled}
                  >
                    {verifyCopy.resendButton}
                  </button>
                )}
              </p>
            </div>
          )}

          <div className='text-center font-light text-[14px]'>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  sessionStorage.removeItem('verificationEmail')
                  sessionStorage.removeItem('inviteRedirectUrl')
                  sessionStorage.removeItem('isInviteFlow')
                }
                router.push('/signup')
              }}
              className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
            >
              {commonCopy.backToSignup}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function VerificationFormFallback() {
  return (
    <div className='text-center'>
      <div className='animate-pulse'>
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-gray-200' />
        <div className='mx-auto h-4 w-64 rounded bg-gray-200' />
      </div>
    </div>
  )
}

export function VerifyContent({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: VerifyContentProps) {
  return (
    <Suspense fallback={<VerificationFormFallback />}>
      <VerificationForm
        hasEmailService={hasEmailService}
        isProduction={isProduction}
        isEmailVerificationEnabled={isEmailVerificationEnabled}
      />
    </Suspense>
  )
}
