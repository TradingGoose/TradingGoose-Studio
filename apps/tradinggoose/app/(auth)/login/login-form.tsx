'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { quickValidateEmail } from '@/lib/email/validation'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getAuthRegistrationHref, type RegistrationMode } from '@/lib/registration/shared'
import { getBaseUrl } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { Link, useRouter } from '@/i18n/navigation'
import { getAuthRegistrationLabel, getPublicCopy } from '@/i18n/public-copy'
import { localizePathname, type LocaleCode } from '@/i18n/utils'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { inter } from '@/app/fonts/inter'

const logger = createLogger('LoginForm')

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

  if (!quickValidateEmail(emailValue.trim().toLowerCase()).isValid) {
    errors.push(messages.invalid)
  }

  return errors
}

const PASSWORD_VALIDATIONS = {
  required: { test: (value: string) => Boolean(value && typeof value === 'string') },
  notEmpty: { test: (value: string) => value.trim().length > 0 },
}

const validateCallbackUrl = (url: string): boolean => {
  try {
    if (url.startsWith('/')) {
      return true
    }

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    if (url.startsWith(currentOrigin)) {
      return true
    }

    return false
  } catch (error) {
    logger.error('Error validating callback URL:', { error, url })
    return false
  }
}

const validatePassword = (
  passwordValue: string,
  messages: {
    required: string
    empty: string
  }
): string[] => {
  const errors: string[] = []

  if (!PASSWORD_VALIDATIONS.required.test(passwordValue)) {
    errors.push(messages.required)
    return errors
  }

  if (!PASSWORD_VALIDATIONS.notEmpty.test(passwordValue)) {
    errors.push(messages.empty)
    return errors
  }

  return errors
}

export default function LoginPage({
  githubAvailable,
  googleAvailable,
  isProduction,
  registrationMode,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  isProduction: boolean
  registrationMode: RegistrationMode
}) {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)
  const loginCopy = copy.auth.login
  const commonCopy = copy.auth.common
  const authRegistrationLabel = getAuthRegistrationLabel(copy, registrationMode)
  const defaultCallbackUrl = localizePathname(locale, '/workspace')
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [callbackUrl, setCallbackUrl] = useState(defaultCallbackUrl)
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  useEffect(() => {
    if (searchParams) {
      const callback = searchParams.get('callbackUrl')
      if (callback) {
        if (validateCallbackUrl(callback)) {
          setCallbackUrl(callback)
        } else {
          logger.warn('Invalid callback URL detected and blocked:', { url: callback })
        }
      }

      const inviteFlow = searchParams.get('invite_flow') === 'true'
      setIsInviteFlow(inviteFlow)
    }
  }, [searchParams])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && forgotPasswordOpen) {
        handleForgotPassword()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [forgotPasswordEmail, forgotPasswordOpen])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail, {
      required: loginCopy.validation.emailRequired,
      invalid: loginCopy.validation.emailInvalid,
    })
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    const errors = validatePassword(newPassword, {
      required: loginCopy.validation.passwordRequired,
      empty: loginCopy.validation.passwordEmpty,
    })
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const email = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(email, {
      required: loginCopy.validation.emailRequired,
      invalid: loginCopy.validation.emailInvalid,
    })
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    const passwordValidationErrors = validatePassword(password, {
      required: loginCopy.validation.passwordRequired,
      empty: loginCopy.validation.passwordEmpty,
    })
    setPasswordErrors(passwordValidationErrors)
    setShowValidationError(passwordValidationErrors.length > 0)

    if (emailValidationErrors.length > 0 || passwordValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      const safeCallbackUrl = validateCallbackUrl(callbackUrl) ? callbackUrl : defaultCallbackUrl

      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx) => {
            console.error('Login error:', ctx.error)
            const errorMessage: string[] = []

            const status =
              (ctx.error as any)?.status ??
              (ctx.error as any)?.statusCode ??
              (ctx.error as any)?.response?.status

            // If the backend rejected the request due to an invalid/expired auth state, hard reset auth.
            if (status === 401) {
              handleAuthError('login-unauthorized').catch(() => {})
              errorMessage.push(loginCopy.errors.sessionExpired)
            }

            if (ctx.error.code?.includes('EMAIL_NOT_VERIFIED')) {
              return
            }
            if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign in is not enabled')
            ) {
              errorMessage.push(loginCopy.errors.emailSignInDisabled)
            } else if (
              ctx.error.code?.includes('INVALID_CREDENTIALS') ||
              ctx.error.message?.includes('invalid password')
            ) {
              errorMessage.push(loginCopy.errors.invalidCredentials)
            } else if (
              ctx.error.code?.includes('USER_NOT_FOUND') ||
              ctx.error.message?.includes('not found')
            ) {
              errorMessage.push(loginCopy.errors.noAccount)
            } else if (ctx.error.code?.includes('MISSING_CREDENTIALS')) {
              errorMessage.push(loginCopy.errors.missingCredentials)
            } else if (ctx.error.code?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage.push(loginCopy.errors.emailPasswordDisabled)
            } else if (ctx.error.code?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage.push(loginCopy.errors.failedToCreateSession)
            } else if (ctx.error.code?.includes('too many attempts')) {
              errorMessage.push(loginCopy.errors.tooManyAttempts)
            } else if (ctx.error.code?.includes('account locked')) {
              errorMessage.push(loginCopy.errors.accountLocked)
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push(loginCopy.errors.network)
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage.push(loginCopy.errors.rateLimit)
            } else {
              errorMessage.push(loginCopy.errors.unableToSignIn)
            }

            if (errorMessage.length === 0) {
              errorMessage.push(loginCopy.errors.unableToSignInNow)
            }

            setPasswordErrors(errorMessage)
            setShowValidationError(true)
          },
        }
      )

      if (!result || result.error) {
        setPasswordErrors([loginCopy.errors.unableToSignInNow])
        setShowValidationError(true)
        setIsLoading(false)
        return
      }
    } catch (err: any) {
      if (err.message?.includes('not verified') || err.code?.includes('EMAIL_NOT_VERIFIED')) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('verificationEmail', email)
        }
        router.push('/verify')
        return
      }

      console.error('Uncaught login error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!forgotPasswordEmail) {
      setResetStatus({
        type: 'error',
        message: loginCopy.resetDialog.emailRequired,
      })
      return
    }

    const emailValidation = quickValidateEmail(forgotPasswordEmail.trim().toLowerCase())
    if (!emailValidation.isValid) {
      setResetStatus({
        type: 'error',
        message: loginCopy.resetDialog.emailInvalid,
      })
      return
    }

    try {
      setIsSubmittingReset(true)
      setResetStatus({ type: null, message: '' })

      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: forgotPasswordEmail,
          redirectTo: `${getBaseUrl()}${localizePathname(locale, '/reset-password')}`,
        }),
      })

      if (!response.ok) {
        throw new Error(loginCopy.resetDialog.error)
      }

      setResetStatus({
        type: 'success',
        message: loginCopy.resetDialog.success,
      })

      setTimeout(() => {
        setForgotPasswordOpen(false)
        setResetStatus({ type: null, message: '' })
      }, 2000)
    } catch (error) {
      logger.error('Error requesting password reset:', { error })
      setResetStatus({
        type: 'error',
        message: loginCopy.resetDialog.error,
      })
    } finally {
      setIsSubmittingReset(false)
    }
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable
  const showBottomSection = hasSocial || ssoEnabled
  const showDivider = showBottomSection
  const showWaitlistNote = registrationMode === 'waitlist' && !isInviteFlow
  const registrationHref = isInviteFlow
    ? `/signup?invite_flow=true&callbackUrl=${encodeURIComponent(callbackUrl)}`
    : getAuthRegistrationHref(registrationMode)
  const registrationLabel = isInviteFlow ? commonCopy.signUp : authRegistrationLabel

  return (
    <>
      <AuthPageHeader
        eyebrow={loginCopy.eyebrow}
        title={loginCopy.title}
        description={loginCopy.description}
      />

      {showWaitlistNote ? <AuthWaitlistNote /> : null}

      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
        <div className='space-y-6'>
          <div className='space-y-2' suppressHydrationWarning>
            <div className='flex items-center justify-between'>
              <Label htmlFor='email'>{commonCopy.email}</Label>
            </div>
            <Input
              id='email'
              name='email'
              suppressHydrationWarning
              placeholder={commonCopy.enterYourEmail}
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
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
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='password'>{commonCopy.password}</Label>
              <button
                type='button'
                onClick={() => setForgotPasswordOpen(true)}
                className='font-medium text-muted-foreground text-xs transition hover:text-foreground'
              >
                {commonCopy.forgotPassword}
              </button>
            </div>
            <div className='relative' suppressHydrationWarning>
              <Input
                id='password'
                name='password'
                suppressHydrationWarning
                required
                type={showPassword ? 'text' : 'password'}
                autoCapitalize='none'
                autoComplete='current-password'
                autoCorrect='off'
                placeholder={commonCopy.enterYourPassword}
                value={password}
                onChange={handlePasswordChange}
                className={cn(
                  'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                  showValidationError &&
                    passwordErrors.length > 0 &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              <button
                type='button'
                onClick={() => setShowPassword(!showPassword)}
                className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
                aria-label={showPassword ? commonCopy.hidePassword : commonCopy.showPassword}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {showValidationError && passwordErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-red-400 text-xs'>
                {passwordErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <Button type='submit' className={primaryButtonClasses} disabled={isLoading}>
          {isLoading ? loginCopy.submitting : loginCopy.submit}
        </Button>
      </form>

      {/* Divider - show when we have multiple auth methods */}
      {showDivider && (
        <div className={`${inter.className} relative my-6 font-light`}>
          <div className='absolute inset-0 flex items-center'>
            <div className='divider w-full border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-background px-4 font-[340] text-muted-foreground'>
              {loginCopy.divider}
            </span>
          </div>
        </div>
      )}

      {showBottomSection && (
        <div className={inter.className}>
          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          >
            {ssoEnabled && <SSOLoginButton callbackURL={callbackUrl} variant='outline' />}
          </SocialLoginButtons>
        </div>
      )}

      {registrationHref && registrationLabel && (
        <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
          <span className='font-normal'>{commonCopy.dontHaveAccount} </span>
          <Link
            href={registrationHref}
            className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
          >
            {registrationLabel}
          </Link>
        </div>
      )}

      <div
        className={`${inter.className} text-muted absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
      >
        {commonCopy.termsLeadSigningIn}{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-primary underline underline-offset-4'
        >
          {commonCopy.termsOfService}
        </Link>{' '}
        {commonCopy.and}{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-primary underline underline-offset-4'
        >
          {commonCopy.privacyPolicy}
        </Link>
      </div>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className='card card-shadow max-w-[540px] rounded-md border backdrop-blur-sm'>
          <DialogHeader>
            <DialogTitle className='text-primary font-semibold text-xl tracking-tight'>
              {loginCopy.resetDialog.title}
            </DialogTitle>
            <DialogDescription className='text-muted-foreground text-sm'>
              {loginCopy.resetDialog.description}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='reset-email'>{loginCopy.resetDialog.emailLabel}</Label>
              </div>
              <Input
                id='reset-email'
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder={loginCopy.resetDialog.emailPlaceholder}
                required
                type='email'
                className={cn(
                  'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                  resetStatus.type === 'error' &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {resetStatus.type === 'error' && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  <p>{resetStatus.message}</p>
                </div>
              )}
            </div>
            {resetStatus.type === 'success' && (
              <div className='mt-1 space-y-1 text-[#4CAF50] text-xs'>
                <p>{resetStatus.message}</p>
              </div>
            )}
            <Button
              type='button'
              onClick={handleForgotPassword}
              className={primaryButtonClasses}
              disabled={isSubmittingReset}
            >
              {isSubmittingReset ? loginCopy.resetDialog.submitting : loginCopy.resetDialog.submit}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
