'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { useSession } from '@/lib/auth-client'
import { startOAuthConnectFlow } from '@/lib/oauth/connect'
import { usePathname } from '@/i18n/navigation'

export default function RobinhoodAuthorizePage() {
  const t = useTranslations('auth')
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  const callbackURL = searchParams.get('callbackURL') ?? ''

  useEffect(() => {
    if (isPending || started.current) return
    started.current = true
    const connection = session?.user?.id
      ? startOAuthConnectFlow({ providerId: 'robinhood', callbackURL })
      : handleAuthError('robinhood-connect', pathname)
    void connection.catch(() => {
      setFailed(true)
    })
  }, [callbackURL, isPending, pathname, session?.user?.id])

  return (
    <p className='text-center text-muted-foreground text-sm' role={failed ? 'alert' : 'status'}>
      {failed ? t('error.default.title') : t('social.connecting')}
    </p>
  )
}
