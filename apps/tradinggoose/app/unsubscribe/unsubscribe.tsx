'use client'

import { Suspense, useEffect, useState } from 'react'
import { CheckCircle, Heart, Info, Loader2, XCircle } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useMessages } from 'next-intl'
import { type LocaleCode } from '@/i18n/utils'
import { useBrandConfig } from '@/lib/branding/branding'

interface UnsubscribeData {
  success: boolean
  email: string
  token: string
  emailType: string
  isTransactional: boolean
  currentPreferences: {
    unsubscribeAll?: boolean
    unsubscribeMarketing?: boolean
    unsubscribeUpdates?: boolean
    unsubscribeNotifications?: boolean
  }
}

function UnsubscribeContent() {
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const unsubscribeCopy = copy.unsubscribe
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<UnsubscribeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [unsubscribed, setUnsubscribed] = useState(false)
  const brand = useBrandConfig()

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

  const handleUnsubscribe = async (type: 'all' | 'marketing' | 'updates' | 'notifications') => {
    if (!email || !token) return

    setProcessing(true)

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
        // Update the data to reflect the change
        if (data) {
          // Type-safe property construction with validation
          const validTypes = ['all', 'marketing', 'updates', 'notifications'] as const
          if (validTypes.includes(type)) {
            if (type === 'all') {
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  unsubscribeAll: true,
                },
              })
            } else {
              const propertyKey = `unsubscribe${type.charAt(0).toUpperCase()}${type.slice(1)}` as
                | 'unsubscribeMarketing'
                | 'unsubscribeUpdates'
                | 'unsubscribeNotifications'
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  [propertyKey]: true,
                },
              })
            }
          }
        }
      } else {
        setError(result.code || result.error || 'failed-processing')
      }
    } catch (error) {
      setError('failed-processing')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardContent className='flex items-center justify-center p-8'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    const errorMessage =
      unsubscribeCopy.errors[error as keyof typeof unsubscribeCopy.errors] ??
      unsubscribeCopy.errors.unknown

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
            <div className='rounded-lg border bg-red-50 p-4'>
              <p className='text-red-800 text-sm'>
                <strong>{unsubscribeCopy.error.label}</strong> {errorMessage}
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

  // Handle transactional emails
  if (data?.isTransactional) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-4'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader className='text-center'>
            <Info className='mx-auto mb-2 h-12 w-12 text-blue-500' />
            <CardTitle className='text-foreground'>{unsubscribeCopy.transactional.title}</CardTitle>
            <CardDescription className='text-muted-foreground'>
              {unsubscribeCopy.transactional.description}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='rounded-lg border bg-blue-50 p-4'>
              <p className='text-blue-800 text-sm'>
                <strong>{unsubscribeCopy.transactional.important}</strong>{' '}
                {unsubscribeCopy.transactional.body}
              </p>
            </div>

            <div className='space-y-3'>
              <p className='text-foreground text-sm'>
                {unsubscribeCopy.transactional.optionsPrefix}
              </p>
              <ul className='ml-4 list-inside list-disc space-y-1 text-muted-foreground text-sm'>
                <li>{unsubscribeCopy.transactional.closeAccount}</li>
                <li>{unsubscribeCopy.transactional.contactSupport}</li>
              </ul>
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              <Button
                onClick={() =>
                  window.open(
                    `mailto:${brand.supportEmail}?subject=Account%20Help&body=Hi%2C%20I%20need%20help%20with%20my%20account%20emails.`,
                    '_blank'
                  )
                }
                className='w-full bg-blue-600 text-white hover:bg-blue-700'
              >
                {unsubscribeCopy.transactional.contactButton}
              </Button>
              <Button onClick={() => window.close()} variant='outline' className='w-full'>
                {unsubscribeCopy.transactional.closeButton}
              </Button>
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
          <CardHeader className='text-center'>
            <CheckCircle className='mx-auto mb-2 h-12 w-12 text-green-500' />
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
              {unsubscribeCopy.main.emailLabel} <span className='font-medium text-foreground'>{data?.email}</span>
            </p>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-3'>
            <Button
              onClick={() => handleUnsubscribe('all')}
              disabled={processing || data?.currentPreferences.unsubscribeAll}
              variant='destructive'
              className='w-full'
            >
              {processing ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
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

            <Button
              onClick={() => handleUnsubscribe('marketing')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeMarketing
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeMarketing ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeMarketing
                ? unsubscribeCopy.main.marketingUnsubscribed
                : unsubscribeCopy.main.marketingButton}
            </Button>

            <Button
              onClick={() => handleUnsubscribe('updates')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeUpdates
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeUpdates ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeUpdates
                ? unsubscribeCopy.main.updatesUnsubscribed
                : unsubscribeCopy.main.updatesButton}
            </Button>

            <Button
              onClick={() => handleUnsubscribe('notifications')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeNotifications
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeNotifications ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeNotifications
                ? unsubscribeCopy.main.notificationsUnsubscribed
                : unsubscribeCopy.main.notificationsButton}
            </Button>
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
  return (
    <Suspense
      fallback={
        <div className='flex min-h-screen items-center justify-center bg-background'>
          <Card className='w-full max-w-md border shadow-sm'>
            <CardContent className='flex items-center justify-center p-8'>
              <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
            </CardContent>
          </Card>
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
