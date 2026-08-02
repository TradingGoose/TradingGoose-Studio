'use client'

import { useState } from 'react'
import type { Messages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import Nav from '@/app/(landing)/components/nav/nav'
import { getChatSsoAuthErrorMessage } from '@/app/chat/errors'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useRouter } from '@/i18n/navigation'

type ChatMessages = Messages['chat']

const logger = createLogger('SSOAuth')

interface SSOAuthProps {
  identifier: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
  copy: ChatMessages
}

export default function SSOAuth({ identifier, copy }: SSOAuthProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { errors: ssoFailureCopy } = copy.auth.sso
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const validateEmailField = (emailValue: string): string[] => {
    const validationMessages: string[] = []

    if (!emailValue || !emailValue.trim()) {
      validationMessages.push(copy.auth.sso.validation.required)
      return validationMessages
    }

    const validation = quickValidateEmail(emailValue.trim().toLowerCase())
    if (!validation.isValid) {
      validationMessages.push(copy.auth.sso.validation.invalid)
    }

    return validationMessages
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setShowEmailValidationError(false)
    setEmailErrors([])
  }

  const handleAuthenticate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isLoading) return

    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      return
    }

    setIsLoading(true)

    try {
      const checkResponse = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, checkSSOAccess: true }),
      })

      if (!checkResponse.ok) {
        const errorData = await checkResponse.json()
        setEmailErrors([
          getChatSsoAuthErrorMessage(copy, errorData.code || errorData.error || null),
        ])
        setShowEmailValidationError(true)
        setIsLoading(false)
        return
      }

      const callbackUrl = `/chat/${identifier}`
      router.push(
        `/sso?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
      )
    } catch (error) {
      logger.error('SSO authentication error:', error)
      setEmailErrors([ssoFailureCopy.authenticationError])
      setShowEmailValidationError(true)
      setIsLoading(false)
    }
  }

  const hasEmailError = showEmailValidationError && emailErrors.length > 0

  return (
    <div className=''>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-1 text-center'>
              <h1 className={`${soehne.className} font-medium text-[32px] tracking-tight`}>
                {copy.auth.sso.title}
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {copy.auth.sso.description}
              </p>
            </div>

            <form
              onSubmit={handleAuthenticate}
              aria-busy={isLoading}
              className={`${inter.className} mt-8 w-full space-y-8`}
            >
              <div className='space-y-6'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='email'>{copy.auth.sso.label}</Label>
                  </div>
                  <Input
                    id='email'
                    name='email'
                    aria-invalid={hasEmailError}
                    aria-describedby={hasEmailError ? 'chat-sso-auth-error' : undefined}
                    required
                    type='email'
                    autoCapitalize='none'
                    autoComplete='email'
                    autoCorrect='off'
                    placeholder={copy.auth.sso.placeholder}
                    value={email}
                    onChange={handleEmailChange}
                    className={cn(
                      'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      hasEmailError &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                    autoFocus
                  />
                  {hasEmailError && (
                    <div
                      id='chat-sso-auth-error'
                      role='alert'
                      aria-atomic='true'
                      className='mt-1 space-y-1 text-red-400 text-xs'
                    >
                      {emailErrors.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Button type='submit' className={primaryButtonClasses} disabled={isLoading}>
                {isLoading ? copy.auth.sso.submitting : copy.auth.sso.submit}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
