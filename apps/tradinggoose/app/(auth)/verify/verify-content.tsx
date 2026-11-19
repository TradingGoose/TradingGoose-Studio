'use client'

import { Suspense, useEffect, useState } from 'react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { useVerification } from '@/app/(auth)/verify/use-verification'
import { inter } from '@/app/fonts/inter'
import { formatTemplate } from '@/i18n/utils'

interface VerifyContentProps {
  hasEmailService: boolean
  isEmailVerificationEnabled: boolean
}

function VerificationForm({ hasEmailService, isEmailVerificationEnabled }: VerifyContentProps) {
  const copy = useMessages()
  const verifyCopy = copy.auth.verify
  const commonCopy = copy.auth.common
  const {
    fromSignup,
    returnToAuth,
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
  } = useVerification({
    hasEmailService,
    isEmailVerificationEnabled,
    copy: verifyCopy,
  })

  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const handleResend = () => {
    resendCode()
    setCountdown(30)
  }

  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  return (
    <>
      <div role='status' aria-live='polite' aria-atomic='true'>
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
                  : verifyCopy.missingServiceDescription
          }
        />
      </div>

      {!isVerified && isEmailVerificationEnabled && (
        <div className={`${inter.className} mt-8 space-y-8`}>
          <div className='space-y-6'>
            <p className='text-center text-muted-foreground text-sm'>
              {hasEmailService
                ? verifyCopy.instructionsWithService
                : verifyCopy.instructionsWithoutService}
            </p>

            <div className='flex justify-center'>
              <Label htmlFor='verification-code' className='sr-only'>
                {verifyCopy.codeLabel}
              </Label>
              <InputOTP
                id='verification-code'
                containerClassName='ph-no-capture'
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={isLoading}
                aria-invalid={isInvalidOtp}
                aria-errormessage={isInvalidOtp ? 'verification-code-error' : undefined}
                className={cn('gap-2', isInvalidOtp && 'otp-error')}
              >
                <InputOTPGroup className='[&>div]:!rounded-md gap-2'>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className={cn(
                        '!rounded-md h-12 w-12 border text-center font-medium text-lg shadow-sm transition-all duration-200',
                        'border-gray-300 hover:border-gray-400',
                        'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                        isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                      )}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            {failureMessage && (
              <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                <p
                  id={isInvalidOtp ? 'verification-code-error' : undefined}
                  role='alert'
                  aria-atomic='true'
                >
                  {failureMessage}
                </p>
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
                  <span>{formatTemplate(verifyCopy.resendIn, { countdown })}</span>
                ) : (
                  <button
                    className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
                    onClick={handleResend}
                    disabled={isLoading}
                  >
                    {verifyCopy.resendButton}
                  </button>
                )}
              </p>
            </div>
          )}

          <div className='text-center font-light text-[14px]'>
            <button
              onClick={returnToAuth}
              className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
            >
              {fromSignup ? commonCopy.backToSignup : commonCopy.backToLogin}
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

export function VerifyContent(props: VerifyContentProps) {
  return (
    <Suspense fallback={<VerificationFormFallback />}>
      <VerificationForm {...props} />
    </Suspense>
  )
}
