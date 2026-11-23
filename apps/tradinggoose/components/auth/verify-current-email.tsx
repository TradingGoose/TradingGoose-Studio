'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type CurrentEmailVerification, client } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'

export function VerifyCurrentEmail({ accountId, email }: CurrentEmailVerification) {
  const t = useTranslations('workspace.settingsModal.account')
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function verify() {
    setSending(true)
    setFailed(false)
    try {
      const { data } = await client.getSession({ query: { disableCookieCache: true } })
      if (data?.user.id !== accountId || data.user.email !== email) {
        setFailed(true)
        return
      }
      const { error } = await client.emailOtp.sendVerificationOtp({
        email,
        type: 'email-verification',
      })
      if (error) {
        setFailed(true)
        return
      }
      sessionStorage.setItem('verificationEmail', email)
      router.push('/verify')
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className='space-y-2'>
      <p role='status'>{t('verifyCurrentEmail', { email })}</p>
      <Button type='button' size='sm' disabled={sending} onClick={verify}>
        {t(sending ? 'sending' : 'verifyEmailButton')}
      </Button>
      {failed && (
        <p role='alert' className='text-destructive text-sm'>
          {t('status.verificationSendFailed')}
        </p>
      )}
    </div>
  )
}
