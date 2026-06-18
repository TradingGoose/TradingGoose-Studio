'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeAuthErrorCode, rememberAuthErrorCallback } from '@/lib/auth/auth-error-copy'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { getAuthRegistrationHref, type RegistrationMode } from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { inter } from '@/app/fonts/inter'
import { Link } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('SSOForm')

const validateEmailField = (
  emailValue: string,
  messages: {
    required: string
    invalid: string
  }
): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push(messages.required)
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(messages.invalid)
  }

  return errors
}

export default function SSOForm({ registrationMode }: { registrationMode: RegistrationMode }) {
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const commonCopy = copy.auth.common
  const ssoCopy = copy.auth.sso
  const defaultCallbackPath = '/workspace'
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'
  const [callbackUrl, setCallbackUrl] = useState(defaultCallbackPath)
  const registrationHref = getAuthRegistrationHref(registrationMode)
  const registrationLabel = copy.registration[registrationMode].auth
  const callbackUrlParam = encodeURIComponent(callbackUrl)

  useEffect(() => {
    if (searchParams) {
      const callback = searchParams.get('callbackUrl')
      if (callback) {
        const normalizedCallback = normalizeCallbackUrl(
          callback,
          typeof window !== 'undefined' ? window.location.origin : undefined
        )

        if (normalizedCallback) {
          setCallbackUrl(normalizedCallback)
        } else {
          logger.warn('Invalid callback URL detected and blocked:', { url: callback })
        }
      }

      const emailParam = searchParams.get('email')
      if (emailParam) {
        setEmail(emailParam)
      }
    }
  }, [searchParams])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail, {
      required: ssoCopy.validation.emailRequired,
      invalid: ssoCopy.validation.emailInvalid,
    })
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const emailValue = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(emailValue, {
      required: ssoCopy.validation.emailRequired,
      invalid: ssoCopy.validation.emailInvalid,
    })
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      rememberAuthErrorCallback(callbackUrl)
      await client.signIn.sso({
        email: emailValue,
        callbackURL: authRedirectUrls.providerCallbackPath(callbackUrl),
        errorCallbackURL: authRedirectUrls.providerErrorPath('/error'),
      })
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email: emailValue })
      const authErrorCode = err instanceof Error ? normalizeAuthErrorCode(err.message) : null

      let errorMessage = ssoCopy.errors.failed
      if (err instanceof Error) {
        if (authErrorCode === 'NO_PROVIDER_FOUND' || authErrorCode === 'INVALID_PROVIDER') {
          errorMessage = ssoCopy.errors.providerNotConfigured
        } else if (authErrorCode === 'INVALID_EMAIL_DOMAIN') {
          errorMessage = ssoCopy.errors.invalidEmailDomain
        } else if (authErrorCode === 'NETWORK_ERROR') {
          errorMessage = ssoCopy.errors.network
        } else if (authErrorCode === 'RATE_LIMIT' || authErrorCode === 'TOO_MANY_REQUESTS') {
          errorMessage = ssoCopy.errors.rateLimit
        } else if (authErrorCode === 'SSO_DISABLED') {
          errorMessage = ssoCopy.errors.ssoDisabled
        } else {
          errorMessage = ssoCopy.errors.failed
        }
      }

      setEmailErrors([errorMessage])
      setShowEmailValidationError(true)
      setIsLoading(false)
    }
  }

  return (
    <>
      <AuthPageHeader
        eyebrow={ssoCopy.eyebrow}
        title={ssoCopy.title}
        description={ssoCopy.description}
      />

      {registrationMode === 'waitlist' ? <AuthWaitlistNote /> : null}

      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
        <div className='space-y-6'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='email'>{commonCopy.workEmail}</Label>
            </div>
            <Input
              id='email'
              name='email'
              placeholder={commonCopy.enterYourWorkEmail}
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              autoFocus
              value={email}
              onChange={handleEmailChange}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                showEmailValidationError &&
                  emailErrors.length > 0 &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
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

        <Button type='submit' className={primaryButtonClasses} disabled={isLoading}>
          {isLoading ? ssoCopy.submitting : commonCopy.continueWithSso}
        </Button>
      </form>

      <div className={`${inter.className} relative my-6 font-light`}>
        <div className='absolute inset-0 flex items-center'>
          <div className='auth-divider w-full border-t' />
        </div>
        <div className='relative flex justify-center text-sm'>
          <span className='bg-background px-4 font-[340] text-muted-foreground'>
            {ssoCopy.divider}
          </span>
        </div>
      </div>

      <div className={`${inter.className} space-y-3`}>
        <Link href={`/login${callbackUrl ? `?callbackUrl=${callbackUrlParam}` : ''}`}>
          <Button
            variant='outline'
            className='w-full rounded-md shadow-sm hover:bg-gray-50'
            type='button'
          >
            {commonCopy.signInWithEmail}
          </Button>
        </Link>
      </div>

      {registrationHref && registrationLabel && (
        <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
          <span className='font-normal'>{commonCopy.dontHaveAccount} </span>
          <Link
            href={`${registrationHref}${callbackUrl ? `?callbackUrl=${callbackUrlParam}` : ''}`}
            className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
          >
            {registrationLabel}
          </Link>
        </div>
      )}

      <div
        className={`${inter.className} absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] text-muted-foreground leading-relaxed sm:px-8 md:px-[44px]`}
      >
        {commonCopy.termsLeadSigningIn}{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='underline underline-offset-4 hover:text-primary'
        >
          {commonCopy.termsOfService}
        </Link>{' '}
        {commonCopy.and}{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='underline underline-offset-4 hover:text-primary'
        >
          {commonCopy.privacyPolicy}
        </Link>
      </div>
    </>
  )
}
