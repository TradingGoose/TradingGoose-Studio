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
import { isSessionRecoveryAuthError } from '@/lib/auth/auth-error-copy'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getRegistrationPrimaryHref, type RegistrationMode } from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'
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
): string[] => {
  const validationMessages: string[] = []

  if (!emailValue || !emailValue.trim()) {
    validationMessages.push(messages.required)
    return validationMessages
  }

  if (emailValue.includes('@') && !quickValidateEmail(emailValue.trim().toLowerCase()).isValid) {
    validationMessages.push(messages.invalid)
  }

  return validationMessages
}

const PASSWORD_VALIDATIONS = {
  required: { test: (value: string) => Boolean(value && typeof value === 'string') },
  notEmpty: { test: (value: string) => value.trim().length > 0 },
}

const validatePassword = (
  passwordValue: string,
  messages: {
    required: string
    empty: string
  }
): string[] => {
  const validationMessages: string[] = []

  if (!PASSWORD_VALIDATIONS.required.test(passwordValue)) {
    validationMessages.push(messages.required)
    return validationMessages
  }

  if (!PASSWORD_VALIDATIONS.notEmpty.test(passwordValue)) {
    validationMessages.push(messages.empty)
    return validationMessages
  }

  return validationMessages
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
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const loginCopy = copy.auth.login
  const commonCopy = copy.auth.common
  const authRegistrationLabel = copy.registration[registrationMode].auth
  const defaultCallbackPath = '/workspace'
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [callbackUrl, setCallbackUrl] = useState(defaultCallbackPath)
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

      const inviteFlow = searchParams.get('invite_flow') === 'true'
      setIsInviteFlow(inviteFlow)
    }
  }, [searchParams])

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
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateIdentifierField(newEmail, {
      required: loginCopy.validation.identifierRequired,
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
    if (authErrorCode === 'USERNAME_TOO_SHORT' || authErrorCode === 'USERNAME_TOO_LONG') {
      return copy.auth.signup.validation.usernameLength
    }
    if (authErrorCode === 'INVALID_USERNAME') {
      return copy.auth.signup.validation.usernameInvalid
    }
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

    const emailValidationErrors = validateIdentifierField(email, {
      required: loginCopy.validation.identifierRequired,
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
      await prepareAuthStart()

      const credentials = {
        password,
        callbackURL: authRedirectUrls.providerCallbackPath(callbackUrl),
      }
      const { error } = isEmail
        ? await client.signIn.email({ email, ...credentials })
        : await client.signIn.username({ username: email, ...credentials })
      if (error) throw error
    } catch (err: any) {
      if (isSessionRecoveryError(err)) {
        shouldRunReauthCleanupRef.current = true
        void runReauthCleanup()
        setPasswordErrors([loginCopy.errors.unableToSignInNow])
        setShowValidationError(true)
        return
      }

      const message = resolveLoginErrorMessage(err)
      if (message === null) {
        sessionStorage.setItem('verificationEmail', email)
        router.push('/verify')
        return
      }
      logger.error('Login error:', err)
      setPasswordErrors([message ?? loginCopy.errors.unableToSignInNow])
      setShowValidationError(true)
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
        redirectTo: authRedirectUrls.passwordResetUrl(),
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

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable
  const showBottomSection = hasSocial || ssoEnabled
  const showDivider = showBottomSection
  const showWaitlistNote = registrationMode === 'waitlist' && !isInviteFlow
  const registrationHref = isInviteFlow
    ? `/signup?invite_flow=true&callbackUrl=${encodeURIComponent(callbackUrl)}`
    : getRegistrationPrimaryHref(registrationMode)
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
              aria-invalid={showEmailValidationError && emailErrors.length > 0}
              aria-describedby={
                showEmailValidationError && emailErrors.length > 0
                  ? 'login-email-errors'
                  : undefined
              }
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                showEmailValidationError &&
                  emailErrors.length > 0 &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {showEmailValidationError && emailErrors.length > 0 && (
              <div
                id='login-email-errors'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
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
                aria-invalid={showValidationError && passwordErrors.length > 0}
                aria-describedby={
                  showValidationError && passwordErrors.length > 0
                    ? 'login-password-errors'
                    : undefined
                }
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
              <div
                id='login-password-errors'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
                {passwordErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
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
            beforeSignIn={prepareAuthStart}
          >
            {ssoEnabled && (
              <SSOLoginButton
                callbackURL={callbackUrl}
                variant='outline'
                beforeSignIn={prepareAuthStart}
              />
            )}
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
