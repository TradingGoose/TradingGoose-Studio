'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { GithubIcon, GoogleIcon } from '@/components/icons/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { inter } from '@/app/fonts/inter'
import { useMessages } from 'next-intl'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  isProduction: boolean
  children?: ReactNode
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL,
  isProduction: _isProduction,
  children,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [mounted, setMounted] = useState(false)
  const authRedirectUrls = useAuthRedirectUrls()
  const copy = useMessages()
  const socialCopy = copy.auth.social
  const resolvedCallbackURL = authRedirectUrls.providerCallbackPath(callbackURL)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  function resolveSocialErrorMessage(providerLabel: string, err: any) {
    const errorText = [
      err?.code,
      err?.message,
      err?.error,
      err?.response?.statusText,
      err?.response?.data?.error,
      err?.response?.data?.message,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

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

  async function signInWithGithub() {
    if (!githubAvailable) return

    setIsGithubLoading(true)
    setErrorMessage('')
    try {
      const result = await client.signIn.social({
        provider: 'github',
        callbackURL: resolvedCallbackURL,
      })

      if (result?.error) {
        logger.error('GitHub social sign-in failed', { error: result.error })
        setErrorMessage(resolveSocialErrorMessage(socialCopy.github, result.error))
      }
    } catch (err: any) {
      logger.error('GitHub social sign-in failed', { error: err })
      setErrorMessage(resolveSocialErrorMessage(socialCopy.github, err))
    } finally {
      setIsGithubLoading(false)
    }
  }

  async function signInWithGoogle() {
    if (!googleAvailable) return

    setIsGoogleLoading(true)
    setErrorMessage('')
    try {
      const result = await client.signIn.social({
        provider: 'google',
        callbackURL: resolvedCallbackURL,
      })

      if (result?.error) {
        logger.error('Google social sign-in failed', { error: result.error })
        setErrorMessage(resolveSocialErrorMessage(socialCopy.google, result.error))
      }
    } catch (err: any) {
      logger.error('Google social sign-in failed', { error: err })
      setErrorMessage(resolveSocialErrorMessage(socialCopy.google, err))
    } finally {
      setIsGoogleLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant='outline'
      className='w-full rounded-md shadow-sm hover:bg-muted'
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
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
      onClick={signInWithGoogle}
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
        <Alert variant='destructive' className='border-destructive/30 bg-destructive/10'>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {children}
    </div>
  )
}
