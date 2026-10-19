'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { useSession } from '@/lib/auth-client'
import { startOAuthConnectFlow } from '@/lib/oauth/connect'
import { ROBINHOOD_LOOPBACK_REDIRECT_URI } from '@/lib/oauth/robinhood-constants'
import { Link, usePathname } from '@/i18n/navigation'
import { normalizeCallbackUrl } from '@/i18n/utils'

export default function RobinhoodAuthorizePage() {
  const t = useTranslations('auth')
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  const callbackURL = normalizeCallbackUrl(searchParams.get('callbackURL')) ?? ''
  const relayToken = searchParams.get('relayToken') ?? ''

  useEffect(() => {
    if (isPending || failed || started.current) return
    started.current = true
    if (!relayToken) {
      started.current = false
      setFailed(true)
      return
    }
    if (searchParams.get('complete') === '1') {
      const completionUrl = new URL(ROBINHOOD_LOOPBACK_REDIRECT_URI)
      completionUrl.searchParams.set('complete', relayToken)
      for (const parameter of ['error', 'error_description']) {
        const value = searchParams.get(parameter)
        if (value !== null) completionUrl.searchParams.set(parameter, value)
      }
      window.location.replace(completionUrl.toString())
      return
    }
    const returnParams = new URLSearchParams({ callbackURL, relayToken, complete: '1' })
    const connection = session?.user?.id
      ? startOAuthConnectFlow({
          providerId: 'robinhood',
          callbackURL: `${pathname}?${returnParams}`,
        })
      : handleAuthError('robinhood-connect', pathname)
    void connection.catch(() => {
      started.current = false
      setFailed(true)
    })
  }, [callbackURL, failed, isPending, pathname, relayToken, searchParams, session?.user?.id])

  return (
    <div className='space-y-4 text-center'>
      <p className='text-muted-foreground text-sm' role={failed ? 'alert' : 'status'}>
        {failed ? t('error.default.title') : t('social.connecting')}
      </p>
      {failed && (
        <div className='flex justify-center gap-2'>
          <Button onClick={() => setFailed(false)}>{t('common.retry')}</Button>
          {callbackURL && (
            <Link href={callbackURL} className={buttonVariants({ variant: 'outline' })}>
              {t('common.goBack')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
