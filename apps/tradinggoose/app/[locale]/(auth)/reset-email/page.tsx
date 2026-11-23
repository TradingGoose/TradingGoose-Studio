'use client'

import { type FormEvent, useEffect, useLayoutEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { VerifyCurrentEmail } from '@/components/auth/verify-current-email'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type CurrentEmailVerification,
  client,
  requestEmailChangeLink,
  useSession,
} from '@/lib/auth-client'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { inter } from '@/app/fonts/inter'
import { organizationKeys } from '@/hooks/queries/organization'
import { Link, useRouter } from '@/i18n/navigation'

const LOGIN_RETURN = '/login?callbackUrl=%2Freset-email'
const LOGIN_LINK_KEY = 'reset-email-login-link'
type EmailLink = { accountId: string; otp: string }

export default function ResetEmailPage() {
  const t = useTranslations('auth.resetEmail')
  const router = useRouter()
  const { data: session, isPending } = useSession()
  const userId = session?.user?.id
  const [link, setLink] = useState<EmailLink | null>()

  useLayoutEffect(() => {
    function readLink() {
      const fragment = window.location.hash.slice(1) || sessionStorage.getItem(LOGIN_LINK_KEY)
      if (!fragment) {
        setLink((current) => current ?? null)
        return
      }
      sessionStorage.removeItem(LOGIN_LINK_KEY)
      window.history.replaceState(window.history.state, '', window.location.pathname)
      const params = new URLSearchParams(fragment)
      const accountId = params.get('accountId')
      const otp = params.get('otp')
      setLink(accountId && otp && /^\d{6}$/.test(otp) ? { accountId, otp } : null)
    }
    readLink()
    window.addEventListener('hashchange', readLink)
    return () => window.removeEventListener('hashchange', readLink)
  }, [])

  useEffect(() => {
    if (link && !isPending && !userId) {
      sessionStorage.setItem(LOGIN_LINK_KEY, new URLSearchParams(link).toString())
      router.replace(LOGIN_RETURN)
    }
  }, [isPending, link, router, userId])

  return (
    <div className={`${inter.className} ph-no-capture space-y-8`}>
      <AuthPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {link === undefined ? null : !link ? (
        <p role='alert'>{t('invalidLink')}</p>
      ) : !userId ? (
        <p role='status'>{t('signIn')}</p>
      ) : link.accountId !== userId ? (
        <div className='space-y-4'>
          <p role='alert'>{t('wrongAccount')}</p>
          <Button
            onClick={() => {
              sessionStorage.setItem(LOGIN_LINK_KEY, new URLSearchParams(link).toString())
              router.push(`${LOGIN_RETURN}&reauth=1`)
            }}
          >
            {t('switchAccount')}
          </Button>
        </div>
      ) : (
        <ResetEmailForm key={`${link.accountId}-${link.otp}`} link={link} />
      )}
    </div>
  )
}

function ResetEmailForm({ link }: { link: EmailLink }) {
  const t = useTranslations('auth.resetEmail')
  const { data: session, refetch } = useSession()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'email' | 'code' | 'restart' | 'sent' | 'complete'>('email')
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [verification, setVerification] = useState<CurrentEmailVerification | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const fields = new FormData(event.currentTarget)
    const newEmail = step === 'code' ? target : String(fields.get('newEmail')).trim().toLowerCase()
    setWorking(true)
    setError('')
    try {
      const { error: failure } =
        step === 'code'
          ? await client.emailOtp.changeEmail({ newEmail, otp: String(fields.get('otp')).trim() })
          : await client.emailOtp.requestEmailChange({ newEmail, otp: link.otp })
      if (failure) {
        if (failure.code === 'EMAIL_NOT_VERIFIED' && session?.user?.id === link.accountId) {
          setVerification({ accountId: link.accountId, email: session.user.email })
        } else if (failure.code === 'EMAIL_CHANGE_CODE_DELIVERY_FAILED') {
          setError(t('targetDeliveryFailed'))
          setStep('restart')
        } else if (
          failure.code === 'OTP_EXPIRED' ||
          failure.code === 'TOO_MANY_ATTEMPTS' ||
          failure.code === 'CURRENT_EMAIL_CHANGED' ||
          (step === 'email' && failure.code === 'INVALID_OTP')
        ) {
          setError(
            t(
              step === 'code' && failure.code !== 'CURRENT_EMAIL_CHANGED'
                ? 'codeExpired'
                : 'invalidLink'
            )
          )
          setStep('restart')
        } else {
          setError(
            failure.code === 'INVALID_OTP' ? t('invalidCode') : failure.message || t('failure')
          )
        }
        return
      }
      if (step === 'email') {
        setTarget(newEmail)
        setStep('code')
      } else {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
        ])
        setStep('complete')
      }
    } catch {
      setError(t('failure'))
    } finally {
      setWorking(false)
    }
  }

  async function sendFreshLink() {
    setWorking(true)
    setError('')
    try {
      const required = await requestEmailChangeLink(link.accountId)
      if (required) setVerification(required)
      else setStep('sent')
    } catch {
      setError(t('sendFailure'))
    } finally {
      setWorking(false)
    }
  }

  if (verification) return <VerifyCurrentEmail {...verification} />
  if (step === 'complete') {
    return (
      <div className='space-y-4'>
        <p role='status'>{t('complete', { email: target })}</p>
        <Link href='/workspace' className='text-primary underline'>
          {t('workspace')}
        </Link>
      </div>
    )
  }
  if (step === 'sent') return <p role='status'>{t('sent')}</p>

  return (
    <div className='space-y-4'>
      {step !== 'restart' && (
        <form className='space-y-6' onSubmit={submit} aria-busy={working}>
          {step === 'email' ? (
            <div className='space-y-2'>
              <Label htmlFor='new-email'>{t('newEmail')}</Label>
              <Input
                key='email'
                id='new-email'
                name='newEmail'
                type='email'
                autoComplete='email'
                disabled={working}
                required
              />
            </div>
          ) : (
            <div className='space-y-2'>
              <Label htmlFor='email-change-code'>{t('codeSentTo', { email: target })}</Label>
              <Input
                key='otp'
                id='email-change-code'
                name='otp'
                type='password'
                inputMode='numeric'
                pattern='[0-9]{6}'
                maxLength={6}
                autoComplete='one-time-code'
                disabled={working}
                required
              />
            </div>
          )}
          <Button type='submit' className='w-full' disabled={working}>
            {t(step === 'email' ? 'sendCode' : 'confirm')}
          </Button>
        </form>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {(step === 'code' || step === 'restart') && (
        <div className='space-y-2'>
          <p className='text-muted-foreground text-sm'>{t('restartHint')}</p>
          <Button variant='outline' disabled={working} onClick={sendFreshLink}>
            {t('restart')}
          </Button>
        </div>
      )}
    </div>
  )
}
