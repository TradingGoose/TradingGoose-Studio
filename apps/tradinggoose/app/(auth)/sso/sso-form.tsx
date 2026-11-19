'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveSsoAuthErrorMessage } from '@/lib/auth/auth-error-copy'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { getRegistrationPrimaryHref, type RegistrationMode } from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { inter } from '@/app/fonts/inter'
import { Link } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('SSOForm')

export default function SSOForm({ registrationMode }: { registrationMode: RegistrationMode }) {
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const commonCopy = copy.auth.common
  const ssoCopy = copy.auth.sso
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'
  const callbackUrl =
    normalizeCallbackUrl(
      searchParams?.get('callbackUrl'),
      typeof window !== 'undefined' ? window.location.origin : undefined
    ) ?? '/workspace'
  const isInviteFlow =
    searchParams?.get('invite_flow') === 'true' || callbackUrl.startsWith('/invite/')
  const signupMode = isInviteFlow ? 'open' : registrationMode
  const registrationHref = getRegistrationPrimaryHref(signupMode)
  const registrationLabel = copy.registration[signupMode].auth
  const returnQuery = `?callbackUrl=${encodeURIComponent(callbackUrl)}${isInviteFlow ? '&invite_flow=true' : ''}`

  useEffect(() => {
    const emailParam = searchParams?.get('email')
    if (emailParam) setEmail(emailParam)
  }, [searchParams])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    setEmailError(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const formData = new FormData(e.currentTarget)
    const emailValue = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase()
    const providerId = String(formData.get('providerId') ?? '').trim()
    if (!emailValue) {
      setEmailError(ssoCopy.validation.emailRequired)
      return
    }
    if (!quickValidateEmail(emailValue).isValid) {
      setEmailError(ssoCopy.validation.emailInvalid)
      return
    }

    setEmailError(null)
    setIsLoading(true)
    let error: { code?: string; message?: string } | null
    try {
      const result = await client.signIn.sso({
        email: emailValue,
        ...(providerId ? { providerId } : {}),
        callbackURL: authRedirectUrls.providerCallbackPath(callbackUrl),
        errorCallbackURL: authRedirectUrls.providerErrorPath(callbackUrl),
      })
      error = result.error
    } catch (cause) {
      error = cause instanceof Error ? cause : {}
    }
    if (!error) return

    logger.error('SSO sign-in failed', { error, email: emailValue })
    setEmailError(
      resolveSsoAuthErrorMessage(copy, error.code) ??
        resolveSsoAuthErrorMessage(copy, error.message) ??
        ssoCopy.errors.failed
    )
    setIsLoading(false)
  }

  return (
    <>
      <AuthPageHeader
        eyebrow={ssoCopy.eyebrow}
        title={ssoCopy.title}
        description={ssoCopy.description}
      />

      {signupMode === 'waitlist' ? <AuthWaitlistNote /> : null}

      <form
        onSubmit={onSubmit}
        noValidate
        aria-busy={isLoading}
        className={`${inter.className} mt-8 space-y-8`}
      >
        <div className='space-y-6'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='email'>{commonCopy.workEmail}</Label>
            </div>
            <Input
              id='email'
              name='email'
              type='email'
              placeholder={commonCopy.enterYourWorkEmail}
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              autoFocus
              value={email}
              onChange={handleEmailChange}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'sso-email-error' : undefined}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                emailError &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {emailError && (
              <div
                id='sso-email-error'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
                <p>{emailError}</p>
              </div>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='sso-provider-id'>{ssoCopy.providerId}</Label>
            <Input id='sso-provider-id' name='providerId' autoCapitalize='none' />
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
        <Link
          href={`/login${returnQuery}`}
          className={buttonVariants({
            variant: 'outline',
            className: 'w-full rounded-md shadow-sm hover:bg-gray-50',
          })}
        >
          {commonCopy.signInWithEmail}
        </Link>
      </div>

      {registrationHref && registrationLabel && (
        <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
          <span className='font-normal'>{commonCopy.dontHaveAccount} </span>
          <Link
            href={`${registrationHref}${returnQuery}`}
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
