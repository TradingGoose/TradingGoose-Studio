'use client'

import { type FormEvent, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { normalizeAuthErrorCode } from '@/lib/auth/auth-error-copy'
import { client, useSession } from '@/lib/auth-client'
import { organizationKeys } from '@/hooks/queries/organization'
import { workspaceKeys } from '@/hooks/queries/workspace'

const ERROR_KEYS = {
  INVALID_EMAIL: 'invalidEmail',
  EMAIL_IS_THE_SAME: 'sameEmail',
  EMAIL_ALREADY_IN_USE: 'inUse',
  EMAIL_CHANGE_EMAIL_IN_USE: 'inUse',
  EMAIL_CHANGE_NOT_ALLOWED: 'notAllowed',
  EMAIL_CHANGE_UNAVAILABLE: 'unavailable',
  INVALID_OTP: 'invalidCode',
  OTP_EXPIRED: 'expiredCode',
  TOO_MANY_ATTEMPTS: 'tooManyAttempts',
  TOO_MANY_REQUESTS: 'tooManyAttempts',
  UNAUTHORIZED: 'sessionExpired',
  SESSION_EXPIRED: 'sessionExpired',
  SESSION_NOT_FRESH: 'sessionExpired',
} as const

export function ChangeEmailForm({
  email,
  onEmailChanged,
}: {
  email: string
  onEmailChanged: (email: string) => void
}) {
  const t = useTranslations('workspace.settingsModal.account.emailChange')
  const tAccount = useTranslations('workspace.settingsModal.account')
  const { data: session, refetch } = useSession()
  const queryClient = useQueryClient()
  const currentEmail = email || session?.user?.email || ''
  const [step, setStep] = useState<'email' | 'current' | 'new' | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const pendingRef = useRef(false)

  const cancel = () => {
    if (pendingRef.current) return
    setStep(null)
    setNewEmail('')
    setOtp('')
    setError(null)
    setIsSuccess(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pendingRef.current) return
    const resend = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'resend'
    const targetEmail = newEmail.trim().toLowerCase()
    if (step === 'email' && targetEmail === currentEmail.trim().toLowerCase()) {
      setError(t('errors.sameEmail'))
      return
    }

    pendingRef.current = true
    setIsLoading(true)
    setError(null)
    setIsSuccess(false)
    try {
      if (step === 'email' || resend) {
        const result = await client.emailOtp.sendVerificationOtp({
          email: currentEmail,
          type: 'email-verification',
        })
        if (result.error) throw result.error
        setNewEmail(targetEmail)
        setStep('current')
      } else if (step === 'current') {
        const result = await client.emailOtp.requestEmailChange({ newEmail: targetEmail, otp })
        if (result.error) throw result.error
        setStep('new')
      } else {
        const result = await client.emailOtp.changeEmail({ newEmail: targetEmail, otp })
        if (result.error) throw result.error
        onEmailChanged(targetEmail)
        setStep(null)
        setNewEmail('')
        setIsSuccess(true)
        await Promise.allSettled([
          refetch(),
          queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
          queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
        ])
      }
    } catch (cause) {
      const failure = cause as { code?: string; message?: string; status?: number }
      const code =
        failure?.status === 401
          ? 'UNAUTHORIZED'
          : normalizeAuthErrorCode(failure?.code || failure?.message)
      const fallback = step === 'new' && !resend ? 'changeFailed' : 'sendFailed'
      const reason = ERROR_KEYS[code as keyof typeof ERROR_KEYS] ?? fallback
      setError(t(`errors.${reason}`))
      if (
        (step === 'current' &&
          !['invalidCode', 'expiredCode', 'tooManyAttempts'].includes(reason)) ||
        ['invalidEmail', 'sameEmail', 'inUse', 'notAllowed'].includes(reason)
      )
        setStep('email')
    } finally {
      setOtp('')
      pendingRef.current = false
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-1'>
      {step === null ? (
        <div className='flex items-center gap-2'>
          <p className='font-medium'>{currentEmail || '—'}</p>
          <button
            type='button'
            className='inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
            disabled={!currentEmail || isLoading}
            onClick={() => {
              setNewEmail(currentEmail)
              setIsSuccess(false)
              setStep('email')
            }}
          >
            <Pencil className='h-3.5 w-3.5' />
            <span className='sr-only'>{tAccount('editEmail')}</span>
          </button>
        </div>
      ) : (
        <form aria-label={t('title')} onSubmit={submit} className='max-w-md space-y-3 py-1.5'>
          {step === 'email' ? (
            <div className='space-y-1'>
              <Label htmlFor='account-new-email'>{t('newEmail')}</Label>
              <Input
                id='account-new-email'
                type='email'
                required
                autoComplete='email'
                autoFocus
                value={newEmail}
                disabled={isLoading}
                className='h-8'
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'account-email-error' : undefined}
                onChange={(event) => {
                  setNewEmail(event.target.value)
                  setError(null)
                }}
              />
            </div>
          ) : (
            <div className='space-y-2'>
              <p role='status' className='text-muted-foreground text-sm'>
                {step === 'current'
                  ? t('currentCodeSent', { email: currentEmail })
                  : t('newCodeSent', { email: newEmail })}
              </p>
              <Label htmlFor='account-email-code'>
                {t(step === 'current' ? 'currentCode' : 'newCode')}
              </Label>
              <InputOTP
                key={step}
                id='account-email-code'
                inputMode='numeric'
                autoComplete='one-time-code'
                maxLength={6}
                pattern='[0-9]*'
                autoFocus
                value={otp}
                disabled={isLoading}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'account-email-error' : undefined}
                onChange={(value) => {
                  setOtp(value)
                  setError(null)
                }}
              >
                <InputOTPGroup className='[&>div]:!rounded-md gap-2'>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className='h-8 w-8 border text-sm' />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {step === 'new' && (
                <p className='text-muted-foreground text-xs'>{t('restartHint')}</p>
              )}
            </div>
          )}
          {error && (
            <p id='account-email-error' role='alert' className='text-destructive text-xs'>
              {error}
            </p>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button
              type='submit'
              size='sm'
              disabled={isLoading || (step !== 'email' && otp.length !== 6)}
              aria-busy={isLoading || undefined}
            >
              {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {t(step === 'email' ? 'sendCode' : step === 'current' ? 'verifyCurrent' : 'confirm')}
            </Button>
            {step !== 'email' && (
              <Button type='submit' value='resend' variant='outline' size='sm' disabled={isLoading}>
                {t(step === 'current' ? 'resend' : 'restart')}
              </Button>
            )}
            <Button type='button' variant='ghost' size='sm' disabled={isLoading} onClick={cancel}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      {isSuccess && (
        <p role='status' className='text-muted-foreground text-xs'>
          {t('success')}
        </p>
      )}
    </div>
  )
}
