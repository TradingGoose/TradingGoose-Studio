'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
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
import { getUsernameErrorMessage, isSessionRecoveryAuthError } from '@/lib/auth/auth-error-copy'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { getRegistrationPrimaryHref, type RegistrationMode } from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { inter } from '@/app/fonts/inter'
import { Link, useRouter } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'
import { clearUserData } from '@/stores'

const logger = createLogger('LoginForm')
const REAUTH_CLEANUP_TIMEOUT_MS = 4000

const validateIdentifierField = (
  emailValue: string,
  messages: {
    required: string
    invalid: string
  }
): string => {
  if (!emailValue) return messages.required
  if (emailValue.includes('@') && !quickValidateEmail(emailValue).isValid) return messages.invalid
  return ''
}

const validatePassword = (
  passwordValue: string,
  messages: {
    required: string
    empty: string
  }
): string => {
  if (!passwordValue) return messages.required
  if (!passwordValue.trim()) return messages.empty
  return ''
}

export default function LoginPage({
  githubAvailable,
  googleAvailable,
  registrationMode,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  registrationMode: RegistrationMode
}) {
  const router = useRouter()
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const loginCopy = copy.auth.login
  const commonCopy = copy.auth.common
  const authRegistrationLabel = copy.registration[registrationMode].auth
  const searchParams = useSearchParams()
  const callbackUrl =
    normalizeCallbackUrl(
      searchParams.get('callbackUrl'),
      typeof window !== 'undefined' ? window.location.origin : undefined
    ) ?? '/workspace'
  const isInviteFlow = searchParams.get('invite_flow') === 'true'
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const isReauth = searchParams.get('reauth') === '1'
  const shouldRunReauthCleanupRef = useRef(isReauth)
  const reauthCleanupPromiseRef = useRef<Promise<void> | null>(null)

  const runReauthCleanup = useCallback(() => {
    if (reauthCleanupPromiseRef.current) {
      return reauthCleanupPromiseRef.current
    }

    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const signOutPromise = client
      .signOut({ fetchOptions: { signal: abortController.signal } })
      .then(() => undefined)
      .catch((error) => {
        if (!abortController.signal.aborted) {
          logger.warn('Reauth sign-out failed', { error })
        }
      })
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        abortController.abort()
        resolve()
      }, REAUTH_CLEANUP_TIMEOUT_MS)
    })

    const cleanupPromise = Promise.race([signOutPromise, timeoutPromise]).finally(async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await clearUserData()
      shouldRunReauthCleanupRef.current = false
      reauthCleanupPromiseRef.current = null
    })

    reauthCleanupPromiseRef.current = cleanupPromise
    return cleanupPromise
  }, [])

  const prepareAuthStart = useCallback(async () => {
    if (shouldRunReauthCleanupRef.current || reauthCleanupPromiseRef.current) {
      await runReauthCleanup()
    }
  }, [runReauthCleanup])

  useEffect(() => {
    shouldRunReauthCleanupRef.current = isReauth
    if (isReauth) {
      void runReauthCleanup()
    }
  }, [isReauth, runReauthCleanup])

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
    setEmail(e.target.value)
    setEmailError('')
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value)
    setPasswordError('')
  }

  const isSessionRecoveryError = (error: any) =>
    isSessionRecoveryAuthError(error?.code, error?.message)

  const resolveLoginErrorMessage = (error: any) => {
    const authErrorCode = error?.code
    if (error?.status === 429) {
      return loginCopy.errors.rateLimit
    }
    if (authErrorCode === 'EMAIL_NOT_VERIFIED') {
      return email.includes('@') ? null : loginCopy.errors.verifyWithEmail
    }
    const usernameMessage = getUsernameErrorMessage(copy.username, authErrorCode)
    if (usernameMessage) return usernameMessage
    if (authErrorCode === 'INVALID_EMAIL') {
      return loginCopy.validation.emailInvalid
    }
    if (
      authErrorCode === 'INVALID_EMAIL_OR_PASSWORD' ||
      authErrorCode === 'INVALID_USERNAME_OR_PASSWORD'
    ) {
      return loginCopy.errors.invalidCredentials
    }
    if (authErrorCode === 'EMAIL_PASSWORD_DISABLED') {
      return loginCopy.errors.emailPasswordDisabled
    }
    if (error instanceof Error && /network|fetch/i.test(error.message)) {
      return loginCopy.errors.network
    }
    return typeof error?.message === 'string' ? error.message.trim() || undefined : undefined
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const isEmail = emailRaw.includes('@')
    const email = isEmail ? emailRaw.trim().toLowerCase() : emailRaw.trim()

    const emailValidationError = validateIdentifierField(email, {
      required: loginCopy.validation.identifierRequired,
      invalid: loginCopy.validation.emailInvalid,
    })
    setEmailError(emailValidationError)

    const passwordValidationError = validatePassword(password, {
      required: loginCopy.validation.passwordRequired,
      empty: loginCopy.validation.passwordEmpty,
    })
    setPasswordError(passwordValidationError)

    if (emailValidationError || passwordValidationError) {
      setIsLoading(false)
      return
    }

    try {
      await prepareAuthStart()

      const credentials = {
        password,
        callbackURL: callbackUrl,
      }
      const { error } = isEmail
        ? await client.signIn.email({ email, ...credentials })
        : await client.signIn.username({ username: email, ...credentials })
      if (error) throw error
    } catch (err: any) {
      if (isSessionRecoveryError(err)) {
        shouldRunReauthCleanupRef.current = true
        void runReauthCleanup()
        setPasswordError(loginCopy.errors.unableToSignInNow)
        return
      }

      const message = resolveLoginErrorMessage(err)
      if (message === null) {
        try {
          const { error } = await client.emailOtp.requestPasswordReset({ email })
          if (error) throw error
          sessionStorage.setItem('verificationEmail', email)
          router.push(
            `/verify?redirectAfter=${encodeURIComponent(callbackUrl)}${isInviteFlow ? '&invite_flow=true' : ''}`
          )
        } catch (error) {
          logger.error('Failed to send login verification code', error)
          setPasswordError(copy.auth.verify.errors.resendFailed)
        }
        return
      }
      logger.error('Login error:', err)
      setPasswordError(message ?? loginCopy.errors.unableToSignInNow)
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

      const { error } = await client.requestPasswordReset({
        email: forgotPasswordEmail.trim().toLowerCase(),
        redirectTo: authRedirectUrls.passwordResetUrl(callbackUrl, isInviteFlow),
      })
      if (error) {
        throw new Error(error.message || loginCopy.resetDialog.error)
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
        message: error instanceof Error ? error.message : loginCopy.resetDialog.error,
      })
    } finally {
      setIsSubmittingReset(false)
    }
  }

  const showWaitlistNote = registrationMode === 'waitlist' && !isInviteFlow
  const registrationPath = isInviteFlow ? '/signup' : getRegistrationPrimaryHref(registrationMode)
  const registrationHref =
    registrationPath === '/signup'
      ? `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}${isInviteFlow ? '&invite_flow=true' : ''}`
      : registrationPath
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
              <Label htmlFor='email'>{loginCopy.identifierLabel}</Label>
            </div>
            <Input
              id='email'
              name='email'
              suppressHydrationWarning
              placeholder={loginCopy.identifierPlaceholder}
              required
              autoCapitalize='none'
              autoComplete='username'
              autoCorrect='off'
              value={email}
              onChange={handleEmailChange}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'login-email-errors' : undefined}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                emailError &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {emailError && (
              <div
                id='login-email-errors'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
                <p>{emailError}</p>
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
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'login-password-errors' : undefined}
                className={cn(
                  'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                  passwordError &&
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
            {passwordError && (
              <div
                id='login-password-errors'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
                <p>{passwordError}</p>
              </div>
            )}
          </div>
        </div>

        <Button
          type='submit'
          className={primaryButtonClasses}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? loginCopy.submitting : loginCopy.submit}
        </Button>
        <span className='sr-only' role='status' aria-live='polite'>
          {isLoading ? loginCopy.submitting : ''}
        </span>
      </form>

      <SocialLoginButtons
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        callbackURL={callbackUrl}
        beforeSignIn={prepareAuthStart}
      />

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
        className={`${inter.className} absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] text-muted leading-relaxed sm:px-8 md:px-[44px]`}
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

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className='card card-shadow max-w-[540px] rounded-md border backdrop-blur-sm'>
          <DialogHeader>
            <DialogTitle className='font-semibold text-primary text-xl tracking-tight'>
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
                autoComplete='email'
                aria-invalid={resetStatus.type === 'error'}
                aria-describedby={resetStatus.type === 'error' ? 'reset-email-error' : undefined}
                className={cn(
                  'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                  resetStatus.type === 'error' &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {resetStatus.type === 'error' && (
                <div
                  id='reset-email-error'
                  role='alert'
                  className='mt-1 space-y-1 text-red-400 text-xs'
                >
                  <p>{resetStatus.message}</p>
                </div>
              )}
            </div>
            {resetStatus.type === 'success' && (
              <div
                role='status'
                aria-live='polite'
                className='mt-1 space-y-1 text-[#4CAF50] text-xs'
              >
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
