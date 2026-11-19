'use client'

import { useState } from 'react'
import { useMessages } from 'next-intl'
import { GithubIcon, GoogleIcon } from '@/components/icons/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { inter } from '@/app/fonts/inter'
import { useRouter } from '@/i18n/navigation'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  beforeSignIn?: () => Promise<void>
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL,
  beforeSignIn,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const authRedirectUrls = useAuthRedirectUrls()
  const router = useRouter()
  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const copy = useMessages()
  const socialCopy = copy.auth.social
  const resolvedCallbackURL = authRedirectUrls.providerCallbackPath(callbackURL)
  const errorCallbackURL = authRedirectUrls.providerErrorPath(resolvedCallbackURL)

  function resolveSocialErrorMessage(providerLabel: string, err: any) {
    const errorText = [err?.code, err?.message].filter(Boolean).join(' ').toLowerCase()

    if (errorText.includes('account exists') || errorText.includes('already exists')) {
      return copy.auth.signup.errors.accountExists
    }
    if (errorText.includes('cancelled') || errorText.includes('canceled')) {
      return formatTemplate(socialCopy.cancelled, { provider: providerLabel })
    }
    if (errorText.includes('network')) {
      return copy.auth.login.errors.network
    }
    if (errorText.includes('rate limit') || errorText.includes('too many')) {
      return copy.auth.login.errors.rateLimit
    }

    return copy.auth.error.default.description
  }

  async function signIn(provider: 'github' | 'google') {
    const setIsLoading = provider === 'github' ? setIsGithubLoading : setIsGoogleLoading
    const providerLabel = socialCopy[provider]
    setIsLoading(true)
    setErrorMessage('')
    try {
      await beforeSignIn?.()
      const result = await client.signIn.social({
        provider,
        callbackURL: resolvedCallbackURL,
        errorCallbackURL,
      })

      if (result?.error) throw result.error
    } catch (err: any) {
      logger.error('Social sign-in failed', { provider, error: err })
      setErrorMessage(resolveSocialErrorMessage(providerLabel, err))
    } finally {
      setIsLoading(false)
    }
  }

  const providers = [
    { id: 'google', Icon: GoogleIcon, available: googleAvailable, loading: isGoogleLoading },
    { id: 'github', Icon: GithubIcon, available: githubAvailable, loading: isGithubLoading },
  ] as const

  if (!githubAvailable && !googleAvailable && !ssoEnabled) return null

  return (
    <>
      <div className={`${inter.className} relative my-6 font-light`}>
        <div className='absolute inset-0 flex items-center'>
          <div className='w-full border-t' />
        </div>
        <div className='relative flex justify-center text-sm'>
          <span className='bg-background px-4 font-[340] text-muted-foreground'>
            {socialCopy.divider}
          </span>
        </div>
      </div>
      <div className={`${inter.className} grid gap-3 font-light`}>
        {providers.map(
          ({ id, Icon, available, loading }) =>
            available && (
              <Button
                key={id}
                variant='outline'
                className='w-full rounded-md shadow-sm hover:bg-muted'
                disabled={loading}
                onClick={() => signIn(id)}
              >
                <Icon className='!h-[18px] !w-[18px] mr-1' />
                {loading ? socialCopy.connecting : socialCopy[id]}
              </Button>
            )
        )}
        {errorMessage ? (
          <Alert
            role='alert'
            variant='destructive'
            className='border-destructive/30 bg-destructive/10'
          >
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {ssoEnabled && (
          <Button
            type='button'
            variant='outline'
            className='w-full rounded-md shadow-sm hover:bg-gray-50'
            onClick={async () => {
              await beforeSignIn?.()
              router.push(`/sso?callbackUrl=${encodeURIComponent(resolvedCallbackURL)}`)
            }}
          >
            {copy.auth.common.signInWithSso}
          </Button>
        )}
      </div>
    </>
  )
}
