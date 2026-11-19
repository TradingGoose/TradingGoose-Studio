'use client'

import { Suspense, useEffect, useState } from 'react'
import { CheckCircle, Heart, Loader2, XCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useMessages } from 'next-intl'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useBrandConfig } from '@/lib/branding/branding'
import type { EmailPreferences, UnsubscribeAction } from '@/lib/email/unsubscribe'

interface UnsubscribeData {
  email: string
  currentPreferences: EmailPreferences
}

function UnsubscribeLoadingState({ label }: { label: string }) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-background'>
      <Card className='w-full max-w-md border shadow-sm'>
        <CardContent
          role='status'
          aria-live='polite'
          aria-atomic='true'
          className='flex items-center justify-center p-8'
        >
          <Loader2 aria-hidden='true' className='h-8 w-8 animate-spin text-muted-foreground' />
          <span className='sr-only'>{label}</span>
        </CardContent>
      </Card>
    </div>
  )
}

function UnsubscribeContent() {
  const copy = useMessages()
  const unsubscribeCopy = copy.unsubscribe
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<UnsubscribeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<UnsubscribeAction | null>(null)
  const [unsubscribed, setUnsubscribed] = useState(false)
  const brand = useBrandConfig()
  const isProcessing = pendingAction !== null

  const email = searchParams.get('email')
  const token = searchParams.get('token')

  useEffect(() => {
    if (!email || !token) {
      setError('missing-parameters')
      setLoading(false)
      return
    }

    // Validate the unsubscribe link
    fetch(
      `/api/users/me/settings/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setData(data)
        } else {
          setError(data.code || data.error || 'invalid-link')
        }
      })
      .catch(() => {
        setError('invalid-link')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [email, token])

  const handleUnsubscribe = async (type: UnsubscribeAction) => {
    if (!email || !token || pendingAction !== null) return

    setPendingAction(type)

    try {
      const response = await fetch('/api/users/me/settings/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          token,
          type,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setUnsubscribed(true)
      } else {
        setError(result.code || result.error || 'failed-processing')
      }
    } catch (error) {
      setError('failed-processing')
    } finally {
      setPendingAction(null)
    }
  }

  if (loading) {
    return <UnsubscribeLoadingState label={unsubscribeCopy.loading} />
  }

  if (error) {
    const unsubscribeFailureCopy = unsubscribeCopy.errors
    const failureMessage =
      unsubscribeFailureCopy[error as keyof typeof unsubscribeFailureCopy] ??
      unsubscribeFailureCopy.unknown

    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-4'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader className='text-center'>
            <XCircle className='mx-auto mb-2 h-12 w-12 text-red-500' />
            <CardTitle className='text-foreground'>{unsubscribeCopy.error.title}</CardTitle>
            <CardDescription className='text-muted-foreground'>
              {unsubscribeCopy.error.description}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div role='alert' aria-atomic='true' className='rounded-lg border bg-red-50 p-4'>
              <p className='text-red-800 text-sm'>
                <strong>{unsubscribeCopy.error.label}</strong> {failureMessage}
              </p>
            </div>

            <div className='space-y-3'>
              <p className='text-muted-foreground text-sm'>{unsubscribeCopy.error.helpTitle}</p>
              <ul className='ml-4 list-inside list-disc space-y-1 text-muted-foreground text-sm'>
                <li>{unsubscribeCopy.error.missingParameters}</li>
                <li>{unsubscribeCopy.error.expiredOrUsed}</li>
                <li>{unsubscribeCopy.error.copiedIncorrectly}</li>
              </ul>
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              <Button
                onClick={() =>
                  window.open(
                    `mailto:${brand.supportEmail}?subject=Unsubscribe%20Help&body=Hi%2C%20I%20need%20help%20unsubscribing%20from%20emails.%20My%20unsubscribe%20link%20is%20not%20working.`,
                    '_blank'
                  )
                }
                className='w-full bg-primary font-medium text-white shadow-sm transition-colors duration-200 hover:bg-primary-hover'
              >
                {unsubscribeCopy.error.contactSupport}
              </Button>
              <Button onClick={() => window.history.back()} variant='outline' className='w-full'>
                {unsubscribeCopy.error.goBack}
              </Button>
            </div>

            <div className='mt-4 text-center'>
              <p className='text-muted-foreground text-xs'>
                {unsubscribeCopy.error.immediateHelpPrefix}{' '}
                <a
                  href={`mailto:${brand.supportEmail}`}
                  className='text-muted-foreground hover:underline'
                >
                  {brand.supportEmail}
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (unsubscribed) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader role='status' aria-live='polite' aria-atomic='true' className='text-center'>
            <CheckCircle aria-hidden='true' className='mx-auto mb-2 h-12 w-12 text-green-500' />
            <CardTitle className='text-foreground'>{unsubscribeCopy.success.title}</CardTitle>
            <CardDescription className='text-muted-foreground'>
              {unsubscribeCopy.success.description}
            </CardDescription>
          </CardHeader>
          <CardContent className='text-center'>
            <p className='text-muted-foreground text-sm'>
              {unsubscribeCopy.success.followUpPrefix}{' '}
              <a
                href={`mailto:${brand.supportEmail}`}
                className='text-muted-foreground hover:underline'
              >
                {brand.supportEmail}
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-background p-4'>
      <Card className='w-full max-w-md border shadow-sm'>
        <CardHeader className='text-center'>
          <Heart className='mx-auto mb-2 h-12 w-12 text-red-500' />
          <CardTitle className='text-foreground'>{unsubscribeCopy.intro.title}</CardTitle>
          <CardDescription className='text-muted-foreground'>
            {unsubscribeCopy.intro.description}
          </CardDescription>
          <div className='mt-2 rounded-lg border bg-muted/50 p-3'>
            <p className='text-muted-foreground text-xs'>
              {unsubscribeCopy.main.emailLabel}{' '}
              <span className='font-medium text-foreground'>{data?.email}</span>
            </p>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-3'>
            <Button
              onClick={() => handleUnsubscribe('all')}
              disabled={isProcessing || data?.currentPreferences.unsubscribeAll}
              aria-busy={pendingAction === 'all'}
              variant='destructive'
              className='w-full'
            >
              {pendingAction === 'all' ? (
                <Loader2 aria-hidden='true' className='mr-2 h-4 w-4 animate-spin' />
              ) : data?.currentPreferences.unsubscribeAll ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeAll
                ? unsubscribeCopy.main.allButtonUnsubscribed
                : unsubscribeCopy.main.allButton}
            </Button>

            <div className='text-center text-muted-foreground text-sm'>
              {unsubscribeCopy.main.optionsPrefix}
            </div>

            {(
              [
                ['marketing', data?.currentPreferences.unsubscribeMarketing],
                ['updates', data?.currentPreferences.unsubscribeUpdates],
                ['notifications', data?.currentPreferences.unsubscribeNotifications],
              ] as const
            ).map(([list, isUnsubscribed]) => (
              <Button
                key={list}
                onClick={() => handleUnsubscribe(list)}
                disabled={isProcessing || data?.currentPreferences.unsubscribeAll || isUnsubscribed}
                aria-busy={pendingAction === list}
                variant='outline'
                className='w-full'
              >
                {pendingAction === list ? (
                  <Loader2 aria-hidden='true' className='mr-2 h-4 w-4 animate-spin' />
                ) : isUnsubscribed ? (
                  <CheckCircle className='mr-2 h-4 w-4' />
                ) : null}
                {isUnsubscribed
                  ? unsubscribeCopy.main[`${list}Unsubscribed`]
                  : unsubscribeCopy.main[`${list}Button`]}
              </Button>
            ))}
          </div>

          <div className='mt-6 space-y-3'>
            <div className='rounded-lg border bg-muted/50 p-3'>
              <p className='text-center text-muted-foreground text-xs'>
                <strong>{unsubscribeCopy.main.notePrefix}</strong> {unsubscribeCopy.main.noteBody}
              </p>
            </div>

            <p className='text-center text-muted-foreground text-xs'>
              {unsubscribeCopy.main.questionsPrefix}{' '}
              <a
                href={`mailto:${brand.supportEmail}`}
                className='text-muted-foreground hover:underline'
              >
                {brand.supportEmail}
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function Unsubscribe() {
  const unsubscribeCopy = useMessages().unsubscribe

  return (
    <Suspense fallback={<UnsubscribeLoadingState label={unsubscribeCopy.loading} />}>
      <UnsubscribeContent />
    </Suspense>
  )
}
