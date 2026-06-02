'use client'

import { type KeyboardEvent, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import Nav from '@/app/(landing)/components/nav/nav'
import type { ChatMessages } from '@/i18n/message-types'
import { getChatEmailAuthErrorMessage } from '@/app/chat/errors'
import { formatTemplate } from '@/i18n/client-messages'
import { type LocaleCode } from '@/i18n/utils'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('EmailAuth')

interface EmailAuthProps {
  identifier: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
  copy: ChatMessages
}

export default function EmailAuth({
  identifier,
  onAuthSuccess,
  copy,
}: EmailAuthProps) {
  const locale = useLocale() as LocaleCode
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
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

  const validateEmailField = (emailValue: string): string[] => {
    const errors: string[] = []

    if (!emailValue || !emailValue.trim()) {
      errors.push(copy.auth.email.validation.required)
      return errors
    }

    const validation = quickValidateEmail(emailValue.trim().toLowerCase())
    if (!validation.isValid) {
      errors.push(copy.auth.email.validation.invalid)
    }

    return errors
  }

  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSendOtp()
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setEmailErrors(validateEmailField(newEmail))
    setShowEmailValidationError(false)
  }

  const handleSendOtp = async () => {
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      return
    }

    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${identifier}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, locale }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setEmailErrors([
          getChatEmailAuthErrorMessage(copy, errorData.code || errorData.error || null),
        ])
        setShowEmailValidationError(true)
        return
      }

      setShowOtpVerification(true)
    } catch (error) {
      logger.error('Error sending OTP:', error)
      setEmailErrors([copy.auth.email.errors.authenticationError])
      setShowEmailValidationError(true)
    } finally {
      setIsSendingOtp(false)
    }
  }

  const handleVerifyOtp = async (otp?: string) => {
    const codeToVerify = otp || otpValue

    if (!codeToVerify || codeToVerify.length !== 6) {
      return
    }

    setAuthError(null)
    setIsVerifyingOtp(true)

    try {
      const response = await fetch(`/api/chat/${identifier}/otp`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, otp: codeToVerify }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(getChatEmailAuthErrorMessage(copy, errorData.code || errorData.error || null))
        return
      }

      onAuthSuccess()
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      setAuthError(copy.auth.email.errors.verifyFailed)
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResendOtp = async () => {
    setAuthError(null)
    setIsSendingOtp(true)
    setIsResendDisabled(true)
    setCountdown(30)

    try {
      const response = await fetch(`/api/chat/${identifier}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, locale }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(getChatEmailAuthErrorMessage(copy, errorData.code || errorData.error || null))
        setIsResendDisabled(false)
        setCountdown(0)
        return
      }

      setOtpValue('')
    } catch (error) {
      logger.error('Error resending OTP:', error)
      setAuthError(copy.auth.email.errors.resendFailed)
      setIsResendDisabled(false)
      setCountdown(0)
    } finally {
      setIsSendingOtp(false)
    }
  }

  return (
    <div className=''>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-1 text-center'>
              <h1 className={`${soehne.className} font-medium text-[32px] tracking-tight`}>
                {showOtpVerification ? copy.auth.email.verifyTitle : copy.auth.email.title}
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {showOtpVerification
                  ? formatTemplate(copy.auth.email.verifiedDescription, { email })
                  : copy.auth.email.description}
              </p>
            </div>

            <div className={`${inter.className} mt-8 w-full`}>
              {!showOtpVerification ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSendOtp()
                  }}
                  className='space-y-8'
                >
                  <div className='space-y-6'>
                    <div className='space-y-2'>
                      <div className='flex items-center justify-between'>
                        <Label htmlFor='email'>{copy.auth.email.label}</Label>
                      </div>
                      <Input
                        id='email'
                        name='email'
                        placeholder={copy.auth.email.placeholder}
                        required
                        autoCapitalize='none'
                        autoComplete='email'
                        autoCorrect='off'
                        value={email}
                        onChange={handleEmailChange}
                        onKeyDown={handleEmailKeyDown}
                        className={cn(
                          'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showEmailValidationError &&
                            emailErrors.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                        autoFocus
                      />
                      {showEmailValidationError && emailErrors.length > 0 && (
                        <div className='mt-1 space-y-1 text-red-400 text-xs'>
                          {emailErrors.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <Button type='submit' className={primaryButtonClasses} disabled={isSendingOtp}>
                    {isSendingOtp ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {copy.auth.email.submitting}
                      </>
                    ) : (
                      copy.auth.email.submit
                    )}
                  </Button>
                </form>
              ) : (
                <div className='space-y-8'>
                  <div className='space-y-6'>
                    <p className='text-center text-muted-foreground text-sm'>
                      {copy.auth.email.instructions}
                    </p>

                    <div className='flex justify-center'>
                      <InputOTP
                        maxLength={6}
                        value={otpValue}
                        onChange={(value) => {
                          setOtpValue(value)
                          if (value.length === 6) {
                            handleVerifyOtp(value)
                          }
                        }}
                        disabled={isVerifyingOtp}
                        className={cn('gap-2', authError && 'otp-error')}
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
                                authError && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                              )}
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    {authError && (
                      <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                        <p>{authError}</p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={() => handleVerifyOtp()}
                    className={primaryButtonClasses}
                    disabled={otpValue.length !== 6 || isVerifyingOtp}
                  >
                    {isVerifyingOtp ? copy.auth.email.verifying : copy.auth.email.verifyButton}
                  </Button>

                  <div className='text-center'>
                    <p className='text-muted-foreground text-sm'>
                      {copy.auth.email.resendPrompt}{' '}
                      {countdown > 0 ? (
                        <span>
                          {formatTemplate(copy.auth.email.resendIn, { countdown })}
                        </span>
                      ) : (
                        <button
                          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
                          onClick={handleResendOtp}
                          disabled={isVerifyingOtp || isResendDisabled}
                        >
                          {copy.auth.email.resend}
                        </button>
                      )}
                    </p>
                  </div>

                  <div className='text-center font-light text-[14px]'>
                    <button
                      onClick={() => {
                        setShowOtpVerification(false)
                        setOtpValue('')
                        setAuthError(null)
                      }}
                      className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
                    >
                      {copy.auth.email.changeEmail}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
