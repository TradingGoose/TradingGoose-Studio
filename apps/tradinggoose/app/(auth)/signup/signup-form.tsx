'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client, useSession } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  REGISTRATION_DISABLED_MESSAGE,
  REGISTRATION_WAITLIST_MESSAGE,
  type RegistrationMode,
} from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { Link, useRouter } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { localizePathname, type LocaleCode } from '@/i18n/utils'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { AuthWaitlistNote } from '@/app/(auth)/components/auth-waitlist-note'
import { inter } from '@/app/fonts/inter'

const logger = createLogger('SignupForm')

const PASSWORD_VALIDATIONS = {
  minLength: /.{8,}/,
  uppercase: /(?=.*?[A-Z])/,
  lowercase: /(?=.*?[a-z])/,
  number: /(?=.*?[0-9])/,
  special: /(?=.*?[#?!@$%^&*-])/,
}

const NAME_VALIDATIONS = {
  required: (value: string) => Boolean(value && typeof value === 'string'),
  notEmpty: (value: string) => value.trim().length > 0,
  validCharacters: /^[\p{L}\s\-']+$/u,
  noConsecutiveSpaces: /^(?!.*\s\s).*$/,
}

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

function SignupFormContent({
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
  const commonCopy = copy.auth.common
  const signupCopy = copy.auth.signup
  const defaultCallbackUrl = localizePathname(locale, '/workspace')
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const [, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isInviteFlow, setIsInviteFlow] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const [name, setName] = useState('')
  const [nameErrors, setNameErrors] = useState<string[]>([])
  const [showNameValidationError, setShowNameValidationError] = useState(false)

  useEffect(() => {
    setMounted(true)
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
    }

    const redirectParam = searchParams.get('redirect')
    if (redirectParam) {
      setRedirectUrl(redirectParam)

      if (redirectParam.startsWith('/invite/')) {
        setIsInviteFlow(true)
      }
    }

    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }
  }, [searchParams])

  const validatePassword = (passwordValue: string): string[] => {
    const errors: string[] = []

    if (!PASSWORD_VALIDATIONS.minLength.test(passwordValue)) {
      errors.push(signupCopy.validation.passwordMinLength)
    }

    if (!PASSWORD_VALIDATIONS.uppercase.test(passwordValue)) {
      errors.push(signupCopy.validation.passwordUppercase)
    }

    if (!PASSWORD_VALIDATIONS.lowercase.test(passwordValue)) {
      errors.push(signupCopy.validation.passwordLowercase)
    }

    if (!PASSWORD_VALIDATIONS.number.test(passwordValue)) {
      errors.push(signupCopy.validation.passwordNumber)
    }

    if (!PASSWORD_VALIDATIONS.special.test(passwordValue)) {
      errors.push(signupCopy.validation.passwordSpecial)
    }

    return errors
  }

  const validateName = (nameValue: string): string[] => {
    const errors: string[] = []

    if (!NAME_VALIDATIONS.required(nameValue)) {
      errors.push(signupCopy.validation.nameRequired)
      return errors
    }

    if (!NAME_VALIDATIONS.notEmpty(nameValue)) {
      errors.push(signupCopy.validation.nameEmpty)
      return errors
    }

    if (!NAME_VALIDATIONS.validCharacters.test(nameValue.trim())) {
      errors.push(signupCopy.validation.nameCharacters)
    }

    if (!NAME_VALIDATIONS.noConsecutiveSpaces.test(nameValue)) {
      errors.push(signupCopy.validation.nameSpaces)
    }

    return errors
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    setName(rawValue)

    const errors = validateName(rawValue)
    setNameErrors(errors)
    setShowNameValidationError(false)
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail, {
      required: signupCopy.validation.emailRequired,
      invalid: signupCopy.validation.emailInvalid,
    })
    setEmailErrors(errors)
    setShowEmailValidationError(false)

    if (emailError) {
      setEmailError('')
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailValueRaw = formData.get('email') as string
    const emailValue = emailValueRaw.trim().toLowerCase()
    const passwordValue = formData.get('password') as string
    const nameValue = formData.get('name') as string

    const trimmedName = nameValue.trim()

    const nameValidationErrors = validateName(trimmedName)
    setNameErrors(nameValidationErrors)
    setShowNameValidationError(nameValidationErrors.length > 0)

    const emailValidationErrors = validateEmailField(emailValue, {
      required: signupCopy.validation.emailRequired,
      invalid: signupCopy.validation.emailInvalid,
    })
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    const errors = validatePassword(passwordValue)
    setPasswordErrors(errors)

    setShowValidationError(errors.length > 0)

    try {
      if (
        nameValidationErrors.length > 0 ||
        emailValidationErrors.length > 0 ||
        errors.length > 0
      ) {
        if (nameValidationErrors.length > 0) {
          setNameErrors([nameValidationErrors[0]])
          setShowNameValidationError(true)
        }
        if (emailValidationErrors.length > 0) {
          setEmailErrors([emailValidationErrors[0]])
          setShowEmailValidationError(true)
        }
        if (errors.length > 0) {
          setPasswordErrors([errors[0]])
          setShowValidationError(true)
        }
        setIsLoading(false)
        return
      }

      if (trimmedName.length > 100) {
        setNameErrors([signupCopy.validation.nameTooLong])
        setShowNameValidationError(true)
        setIsLoading(false)
        return
      }

      const sanitizedName = trimmedName

      const response = await client.signUp.email(
        {
          email: emailValue,
          password: passwordValue,
          name: sanitizedName,
        },
        {
          onError: (ctx) => {
            logger.error('Signup error:', ctx.error)
            const errorMessage: string[] = [signupCopy.errors.failedToCreateAccount]

            if (ctx.error.code?.includes('USER_ALREADY_EXISTS')) {
              errorMessage.push(signupCopy.errors.accountExists)
              setEmailError(errorMessage[errorMessage.length - 1])
            } else if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign up is not enabled')
            ) {
              if (ctx.error.message?.includes(REGISTRATION_DISABLED_MESSAGE)) {
                errorMessage.push(signupCopy.errors.emailSignupDisabled)
              } else if (ctx.error.message?.includes(REGISTRATION_WAITLIST_MESSAGE)) {
                errorMessage.push(signupCopy.errors.waitlistRequired)
              } else {
                errorMessage.push(signupCopy.errors.signupNotEnabled)
              }
              setEmailError(errorMessage[errorMessage.length - 1])
            } else if (ctx.error.code?.includes('INVALID_EMAIL')) {
              errorMessage.push(signupCopy.errors.invalidEmail)
              setEmailError(errorMessage[errorMessage.length - 1])
            } else if (ctx.error.code?.includes('PASSWORD_TOO_SHORT')) {
              errorMessage.push(signupCopy.errors.passwordTooShort)
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('PASSWORD_TOO_LONG')) {
              errorMessage.push(signupCopy.errors.passwordTooLong)
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push(signupCopy.errors.network)
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('rate limit')) {
              errorMessage.push(signupCopy.errors.rateLimit)
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else {
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            }
          },
        }
      )

      if (!response || response.error) {
        setIsLoading(false)
        return
      }

      try {
        await refetchSession()
        logger.info('Session refreshed after successful signup')
      } catch (sessionError) {
        logger.error('Failed to refresh session after signup:', sessionError)
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailValue)
        if (isInviteFlow && redirectUrl) {
          sessionStorage.setItem('inviteRedirectUrl', redirectUrl)
          sessionStorage.setItem('isInviteFlow', 'true')
        }
      }

      try {
        await client.emailOtp.sendVerificationOtp({
          email: emailValue,
          type: 'sign-in',
        })
      } catch (otpErr) {
        logger.warn('Failed to send sign-in OTP after signup; user can press Resend', otpErr)
      }

      router.push('/verify?fromSignup=true')
    } catch (error) {
      logger.error('Signup error:', error)
      setIsLoading(false)
    }
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable
  const showBottomSection = hasSocial || ssoEnabled
  const showDivider = showBottomSection

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

      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
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
              autoCapitalize='words'
              autoComplete='name'
              title={signupCopy.nameTitle}
              value={name}
              onChange={handleNameChange}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                showNameValidationError &&
                  nameErrors.length > 0 &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            {showNameValidationError && nameErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-red-400 text-xs'>
                {nameErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
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
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              value={email}
              onChange={handleEmailChange}
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                (emailError || (showEmailValidationError && emailErrors.length > 0)) &&
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
            {emailError && !showEmailValidationError && (
              <div className='mt-1 text-red-400 text-xs'>
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
                autoCapitalize='none'
                autoComplete='new-password'
                placeholder={commonCopy.enterYourPassword}
                autoCorrect='off'
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
          {isLoading ? signupCopy.submitting : signupCopy.submit}
        </Button>
      </form>

      {showDivider && (
        <div className={`${inter.className} relative my-6 font-light`}>
          <div className='absolute inset-0 flex items-center'>
            <div className='auth-divider w-full border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-background px-4 font-[340] text-muted-foreground'>
              {signupCopy.divider}
            </span>
          </div>
        </div>
      )}

      {showBottomSection && (
        <div className={inter.className}>
          <SocialLoginButtons
            githubAvailable={githubAvailable}
            googleAvailable={googleAvailable}
            callbackURL={redirectUrl || defaultCallbackUrl}
            isProduction={isProduction}
          >
            {ssoEnabled && (
              <SSOLoginButton callbackURL={redirectUrl || defaultCallbackUrl} variant='outline' />
            )}
          </SocialLoginButtons>
        </div>
      )}

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <span className='font-normal'>{commonCopy.alreadyHaveAccount} </span>
        <Link
          href={
            isInviteFlow
              ? `/login?invite_flow=true&callbackUrl=${encodeURIComponent(redirectUrl)}`
              : '/login'
          }
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          {commonCopy.signIn}
        </Link>
      </div>

      <div
        className={`${inter.className} text-muted-foreground absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
      >
        {commonCopy.termsLeadCreatingAccount}{' '}
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
    </>
  )
}

export default function SignupPage({
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
  return (
    <Suspense
      fallback={<div className='flex h-screen items-center justify-center'>Loading...</div>}
    >
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
        registrationMode={registrationMode}
      />
    </Suspense>
  )
}
