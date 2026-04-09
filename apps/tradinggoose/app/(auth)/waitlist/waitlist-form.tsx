'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { quickValidateEmail } from '@/lib/email/validation'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter'

type WaitlistResponseStatus = 'pending' | 'approved' | 'rejected' | 'signed_up'

export function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<WaitlistResponseStatus | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const normalizedEmail = email.trim().toLowerCase()
    const validation = quickValidateEmail(normalizedEmail)
    if (!validation.isValid) {
      setError(validation.reason || 'Please enter a valid email address.')
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
        throw new Error(payload?.error || 'Failed to join the waitlist')
      }

      setStatus(payload?.status ?? 'pending')
      setEmail(normalizedEmail)
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Failed to join the waitlist'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
        <div className='space-y-6'>
          <div className='space-y-2'>
            <Label htmlFor='waitlist-email'>Email</Label>
            <Input
              id='waitlist-email'
              name='email'
              type='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder='Enter your email'
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
              Use the email address you want reviewed for platform access.
            </p>
          </div>
        </div>

        <Button type='submit' className={primaryButtonClasses} disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Request access'}
        </Button>
      </form>

      {error ? (
        <Alert variant='destructive' className='mt-6'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'pending' ? (
        <Alert className='mt-6'>
          <AlertDescription>
            You are on the waitlist. We will review your request and let you know when access is
            available.
          </AlertDescription>
        </Alert>
      ) : null}

      {status === 'approved' ? (
        <Alert className='mt-6'>
          <AlertDescription>
            Your email is approved. Continue to{' '}
            <Link href={`/signup?email=${encodeURIComponent(email)}`} className='font-medium underline'>
              sign up
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {status === 'signed_up' ? (
        <Alert className='mt-6'>
          <AlertDescription>
            This email already has access. Continue to{' '}
            <Link href='/login' className='font-medium underline'>
              login
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {status === 'rejected' ? (
        <Alert variant='destructive' className='mt-6'>
          <AlertDescription>This waitlist request is not approved for access.</AlertDescription>
        </Alert>
      ) : null}

      <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
        <span className='font-normal'>Already have an account? </span>
        <Link
          href='/login'
          className='font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline'
        >
          Sign in
        </Link>
      </div>
    </>
  )
}
