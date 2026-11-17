'use client'

import { type ReactNode, useState } from 'react'
import { useMessages } from 'next-intl'
import { GithubIcon, GoogleIcon } from '@/components/icons/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { inter } from '@/app/fonts/inter'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  beforeSignIn?: () => Promise<void>
  children?: ReactNode
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL,
  beforeSignIn,
  children,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const socialCopy = copy.auth.social
  const resolvedCallbackURL = authRedirectUrls.providerCallbackPath(callbackURL)
  const errorCallbackURL = authRedirectUrls.providerErrorPath(resolvedCallbackURL)

  function resolveSocialErrorMessage(providerLabel: string, err: any) {
    const errorText = [err?.code, err?.message].filter(Boolean).join(' ').toLowerCase()

    if (
      errorText.includes('account exists') ||
      errorText.includes('already exists') ||
      errorText.includes('user already exists')
    ) {
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
    if (provider === 'github' ? !githubAvailable : !googleAvailable) return

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

      if (result?.error) {
        logger.error('Social sign-in failed', { provider, error: result.error })
        setErrorMessage(resolveSocialErrorMessage(providerLabel, result.error))
      }
    } catch (err: any) {
      logger.error('Social sign-in failed', { provider, error: err })
      setErrorMessage(resolveSocialErrorMessage(providerLabel, err))
    } finally {
      setIsLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant='outline'
      className='w-full rounded-md shadow-sm hover:bg-muted'
      disabled={!githubAvailable || isGithubLoading}
      onClick={() => signIn('github')}
    >
      <GithubIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGithubLoading ? socialCopy.connecting : socialCopy.github}
    </Button>
  )

  const googleButton = (
    <Button
      variant='outline'
      className='w-full rounded-md shadow-sm hover:bg-muted'
      disabled={!googleAvailable || isGoogleLoading}
      onClick={() => signIn('google')}
    >
      <GoogleIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGoogleLoading ? socialCopy.connecting : socialCopy.google}
    </Button>
  )

  const hasAnyOAuthProvider = githubAvailable || googleAvailable

  if (!hasAnyOAuthProvider && !children) {
    return null
  }

  return (
    <div className={`${inter.className} grid gap-3 font-light`}>
      {googleAvailable && googleButton}
      {githubAvailable && githubButton}
      {errorMessage ? (
        <Alert
          role='alert'
          variant='destructive'
          className='border-destructive/30 bg-destructive/10'
        >
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {children}
    </div>
  )
}
