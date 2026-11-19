'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getSignupPasswordError,
  getUsernameErrorMessage,
  normalizeAuthErrorCode,
} from '@/lib/auth/auth-error-copy'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import {
  REGISTRATION_DISABLED_REASON,
  REGISTRATION_WAITLIST_REASON,
  type RegistrationMode,
} from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { inter } from '@/app/fonts/inter'
import { usernameInputProps, useUsernameAvailability } from '@/hooks/queries/username'
import { Link, useRouter } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('SignupForm')

function SignupFormLoadingFallback() {
  const copy = useMessages()

  return <div className='flex h-screen items-center justify-center'>{copy.auth.common.loading}</div>
}

const NAME_VALIDATIONS = {
  validCharacters: /^[\p{L}\s\-']+$/u,
  noConsecutiveSpaces: /^(?!.*\s\s).*$/,
}

const validateEmailField = (
  emailValue: string,
  messages: {
    required: string
    invalid: string
  }
): string => {
  if (!emailValue) return messages.required
  return quickValidateEmail(emailValue).isValid ? '' : messages.invalid
}

function SignupFormContent({
  githubAvailable,
  googleAvailable,
  registrationMode,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  registrationMode: RegistrationMode
}) {
  const router = useRouter()
  const copy = useMessages()
  const commonCopy = copy.auth.common
  const signupCopy = copy.auth.signup
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [usernameCandidate, setUsernameCandidate] = useState('')
  const usernameAvailability = useUsernameAvailability(usernameCandidate)
  const usernameFailure =
    usernameError || (usernameAvailability === 'taken' ? copy.username.taken : '')
  const usernameStatus =
    !usernameFailure && usernameAvailability !== 'idle' && usernameAvailability !== 'taken'
      ? copy.username[usernameAvailability]
      : ''
  const destination =
    normalizeCallbackUrl(
      searchParams.get('callbackUrl'),
      typeof window !== 'undefined' ? window.location.origin : undefined
    ) ?? '/workspace'
  const isInviteFlow =
    searchParams.get('invite_flow') === 'true' || destination.startsWith('/invite/')
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [nameError, setNameError] = useState('')

  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
    }
  }, [searchParams])

  const validateName = (nameValue: string): string => {
    if (!nameValue) return signupCopy.validation.nameRequired
    if (!NAME_VALIDATIONS.validCharacters.test(nameValue)) {
      return signupCopy.validation.nameCharacters
    }

    if (!NAME_VALIDATIONS.noConsecutiveSpaces.test(nameValue)) {
      return signupCopy.validation.nameSpaces
    }

    return ''
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    setEmailError('')
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailValueRaw = formData.get('email') as string
    const emailValue = emailValueRaw.trim().toLowerCase()
    const passwordValue = formData.get('password') as string
    const nameValue = formData.get('name') as string
    const usernameValue = (formData.get('username') as string).trim()
    setUsernameError(usernameValue ? '' : copy.username.required)

    const trimmedName = nameValue.trim()

    const nameValidationError = validateName(trimmedName)
    setNameError(nameValidationError)

    const emailValidationError = validateEmailField(emailValue, {
      required: signupCopy.validation.emailRequired,
      invalid: signupCopy.validation.emailInvalid,
    })
    setEmailError(emailValidationError)

    const passwordValidationError = getSignupPasswordError(signupCopy.validation, passwordValue)
    setPasswordErrors(passwordValidationError ? [passwordValidationError] : [])

    try {
      if (
        !usernameValue ||
        usernameAvailability === 'taken' ||
        nameValidationError ||
        emailValidationError ||
        passwordValidationError
      ) {
        setIsLoading(false)
        return
      }

      if (trimmedName.length > 100) {
        setNameError(signupCopy.validation.nameTooLong)
        setIsLoading(false)
        return
      }

      const response = await client.signUp.email(
        {
          email: emailValue,
          password: passwordValue,
          name: trimmedName,
          username: usernameValue,
        },
        {
          onError: (ctx) => {
            logger.error('Signup error:', ctx.error)
            const errorMessage: string[] = [signupCopy.errors.failedToCreateAccount]
            const messageCode = normalizeAuthErrorCode(ctx.error.message)
            const authErrorCode = normalizeAuthErrorCode(ctx.error.code) ?? messageCode

            const usernameMessage = getUsernameErrorMessage(copy.username, authErrorCode)
            if (usernameMessage) {
              setUsernameError(usernameMessage)
            } else if (authErrorCode === 'USER_ALREADY_EXISTS') {
              setEmailError(signupCopy.errors.accountExists)
            } else if (messageCode === REGISTRATION_DISABLED_REASON.toUpperCase()) {
              setEmailError(signupCopy.errors.emailSignupDisabled)
            } else if (messageCode === REGISTRATION_WAITLIST_REASON.toUpperCase()) {
              setEmailError(signupCopy.errors.waitlistRequired)
            } else if (
              authErrorCode === 'EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED' ||
              authErrorCode === 'BAD_REQUEST'
            ) {
              setEmailError(signupCopy.errors.signupNotEnabled)
            } else if (authErrorCode === 'INVALID_EMAIL') {
              setEmailError(signupCopy.errors.invalidEmail)
            } else if (authErrorCode === 'PASSWORD_TOO_SHORT') {
              errorMessage.push(signupCopy.errors.passwordTooShort)
              setPasswordErrors(errorMessage)
            } else if (authErrorCode === 'PASSWORD_TOO_LONG') {
              errorMessage.push(signupCopy.errors.passwordTooLong)
              setPasswordErrors(errorMessage)
            } else if (authErrorCode === 'NETWORK_ERROR') {
              errorMessage.push(signupCopy.errors.network)
              setPasswordErrors(errorMessage)
            } else if (authErrorCode === 'RATE_LIMIT' || authErrorCode === 'TOO_MANY_REQUESTS') {
              errorMessage.push(signupCopy.errors.rateLimit)
              setPasswordErrors(errorMessage)
            } else {
              setPasswordErrors(errorMessage)
            }
          },
        }
      )

      if (!response || response.error) {
        setIsLoading(false)
        return
      }

      if (!response.data?.token) {
        sessionStorage.setItem('verificationEmail', emailValue)
        try {
          await client.emailOtp.requestPasswordReset({ email: emailValue })
        } catch (otpErr) {
          logger.warn('Failed to send verification OTP after signup; user can press Resend', otpErr)
        }
      }

      router.push(
        `/verify?fromSignup=true&redirectAfter=${encodeURIComponent(destination)}${isInviteFlow ? '&invite_flow=true' : ''}`
      )
    } catch (error) {
      logger.error('Signup error:', error)
      setIsLoading(false)
    }
  }

  return (
    <>
      <AuthPageHeader
        eyebrow={signupCopy.eyebrow}
        title={signupCopy.title}
        description={
          registrationMode === 'waitlist' && !isInviteFlow
            ? signupCopy.descriptionWaitlist
            : signupCopy.descriptionOpen
        }
      />

      {registrationMode === 'waitlist' && !isInviteFlow ? <AuthWaitlistNote /> : null}

      <form
        onSubmit={onSubmit}
        noValidate
        aria-busy={isLoading}
        className={`${inter.className} mt-8 space-y-8`}
      >
        <div className='space-y-6'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='name'>{commonCopy.fullName}</Label>
            </div>
            <Input
              id='name'
              name='name'
              placeholder={commonCopy.enterYourName}
              type='text'
              required
              autoCapitalize='words'
              autoComplete='name'
              title={signupCopy.nameTitle}
              onChange={() => setNameError('')}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'signup-name-errors' : undefined}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                nameError &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {nameError && (
              <div
                id='signup-name-errors'
                role='alert'
                className='mt-1 space-y-1 text-red-400 text-xs'
              >
                <p>{nameError}</p>
              </div>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='username'>{commonCopy.username}</Label>
            <Input
              id='username'
              name='username'
              placeholder={commonCopy.enterYourUsername}
              {...usernameInputProps}
              autoCapitalize='none'
              autoCorrect='off'
              onChange={(event) => {
                setUsernameError('')
                setUsernameCandidate(event.target.validity.valid ? event.target.value : '')
              }}
              aria-invalid={Boolean(usernameFailure)}
              aria-describedby={`signup-username-hint${usernameFailure ? ' signup-username-error' : usernameStatus ? ' signup-username-status' : ''}`}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                usernameFailure &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <p id='signup-username-hint' className='text-muted-foreground text-xs'>
              {signupCopy.usernameHint}
            </p>
            {usernameFailure && (
              <p id='signup-username-error' role='alert' className='text-red-400 text-xs'>
                {usernameFailure}
              </p>
            )}
            {usernameStatus && (
              <p
                id='signup-username-status'
                role='status'
                aria-live='polite'
                className='text-muted-foreground text-xs'
              >
                {usernameStatus}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='email'>{commonCopy.email}</Label>
            </div>
            <Input
              id='email'
              name='email'
              placeholder={commonCopy.enterYourEmail}
              type='email'
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              value={email}
              onChange={handleEmailChange}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'signup-email-errors' : undefined}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                emailError &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {emailError && (
              <div id='signup-email-errors' role='alert' className='mt-1 text-red-400 text-xs'>
                <p>{emailError}</p>
              </div>
            )}
          </div>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='password'>{commonCopy.password}</Label>
            </div>
            <div className='relative'>
              <Input
                id='password'
                name='password'
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                autoCapitalize='none'
                autoComplete='new-password'
                placeholder={commonCopy.enterYourPassword}
                autoCorrect='off'
                onChange={() => setPasswordErrors([])}
                aria-invalid={passwordErrors.length > 0}
                aria-describedby={passwordErrors.length > 0 ? 'signup-password-errors' : undefined}
                className={cn(
                  'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
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
            {passwordErrors.length > 0 && (
              <div
                id='signup-password-errors'
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
          disabled={isLoading || usernameAvailability === 'taken'}
        >
          {isLoading ? signupCopy.submitting : signupCopy.submit}
        </Button>
      </form>

      <SocialLoginButtons
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        callbackURL={destination}
      />

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <span className='font-normal'>{commonCopy.alreadyHaveAccount} </span>
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(destination)}${isInviteFlow ? '&invite_flow=true' : ''}`}
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          {commonCopy.signIn}
        </Link>
      </div>

      <div
        className={`${inter.className} absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] text-muted-foreground leading-relaxed sm:px-8 md:px-[44px]`}
      >
        {commonCopy.termsLeadCreatingAccount}{' '}
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

export default function SignupPage({
  githubAvailable,
  googleAvailable,
  registrationMode,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  registrationMode: RegistrationMode
}) {
  return (
    <Suspense fallback={<SignupFormLoadingFallback />}>
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        registrationMode={registrationMode}
      />
    </Suspense>
  )
}
