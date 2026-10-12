'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { startOAuthConnectFlow } from '@/lib/oauth/connect'

export default function RobinhoodAuthorizePage() {
  const t = useTranslations('workspace.integrations')
  const searchParams = useSearchParams()
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  const callbackURL = searchParams.get('callbackURL') ?? ''

  useEffect(() => {
    if (started.current) return
    started.current = true
    void startOAuthConnectFlow({ providerId: 'robinhood', callbackURL }).catch(() => {
      setFailed(true)
    })
  }, [callbackURL])

  return (
    <p className='text-center text-muted-foreground text-sm' role={failed ? 'alert' : 'status'}>
      {failed ? t('failures.oauth') : t('connecting')}
    </p>
  )
}
