'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { quickValidateEmail } from '@/lib/email/validation'
import { cn } from '@/lib/utils'
import { Link } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { inter } from '@/app/fonts/inter'

type WaitlistResponseStatus = 'pending' | 'approved' | 'rejected' | 'signed_up'

export function WaitlistForm() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)
  const commonCopy = copy.auth.common
  const waitlistCopy = copy.auth.waitlist
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<WaitlistResponseStatus | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const validateEmailField = (emailValue: string): string => {
    if (!emailValue || !emailValue.trim()) {
      return waitlistCopy.validation.emailRequired
    }

    const validation = quickValidateEmail(emailValue.trim().toLowerCase())
    if (!validation.isValid) {
      return waitlistCopy.validation.emailInvalid
    }

    return ''
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const normalizedEmail = email.trim().toLowerCase()
    const validationMessage = validateEmailField(normalizedEmail)
    if (validationMessage) {
      setError(validationMessage)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { status?: WaitlistResponseStatus; error?: string }
        | null

      if (!response.ok) {
        throw new Error(waitlistCopy.rejected)
      }

      setStatus(payload?.status ?? 'pending')
      setEmail(normalizedEmail)
    } catch {
      setError(waitlistCopy.rejected)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
        <div className='space-y-6'>
          <div className='space-y-2'>
            <Label htmlFor='waitlist-email'>{commonCopy.email}</Label>
            <Input
              id='waitlist-email'
              name='email'
              type='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={commonCopy.enterYourEmail}
              autoComplete='email'
              autoCapitalize='none'
              autoCorrect='off'
              required
              className={cn(
                'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                error && 'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {waitlistCopy.helperText}
            </p>
          </div>
        </div>

        <Button type='submit' className={primaryButtonClasses} disabled={isSubmitting}>
          {isSubmitting ? waitlistCopy.submitting : commonCopy.requestAccess}
        </Button>
      </form>

      {error ? (
        <Alert variant='destructive' className='mt-6'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'pending' ? (
        <Alert className='mt-6'>
          <AlertDescription>{waitlistCopy.pending}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'approved' ? (
        <Alert className='mt-6'>
          <AlertDescription>
            {waitlistCopy.approvedPrefix}{' '}
            <Link href={`/signup?email=${encodeURIComponent(email)}`} className='font-medium underline'>
              {waitlistCopy.signUpLink}
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {status === 'signed_up' ? (
        <Alert className='mt-6'>
          <AlertDescription>
            {waitlistCopy.signedUpPrefix}{' '}
            <Link href='/login' className='font-medium underline'>
              {waitlistCopy.loginLink}
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {status === 'rejected' ? (
        <Alert variant='destructive' className='mt-6'>
          <AlertDescription>{waitlistCopy.rejected}</AlertDescription>
        </Alert>
      ) : null}

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <span className='font-normal'>{commonCopy.alreadyHaveAccount} </span>
        <Link
          href='/login'
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          {commonCopy.signIn}
        </Link>
      </div>
    </>
  )
}
