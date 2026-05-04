'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { GithubIcon, GoogleIcon } from '@/components/icons/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useLocale } from 'next-intl'
import { inter } from '@/app/fonts/inter'
import { getPublicCopy } from '@/i18n/public-copy'
import { localizePathname, type LocaleCode } from '@/i18n/utils'

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
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)
  const socialCopy = copy.auth.social
  const resolvedCallbackURL = callbackURL ?? localizePathname(locale, '/workspace')

  // Set mounted state to true on client-side
  useEffect(() => {
    setMounted(true)
  }, [])

  // Only render on the client side to avoid hydration errors
  if (!mounted) return null

  async function signInWithGithub() {
    if (!githubAvailable) return

    setIsGithubLoading(true)
    setErrorMessage('')
    try {
      await client.signIn.social({ provider: 'github', callbackURL: resolvedCallbackURL })
    } catch (err: any) {
      logger.error('GitHub social sign-in failed', { error: err })
      setErrorMessage(copy.auth.error.default.description)
    } finally {
      setIsGithubLoading(false)
    }
  }

  async function signInWithGoogle() {
    if (!googleAvailable) return

    setIsGoogleLoading(true)
    setErrorMessage('')
    try {
      await client.signIn.social({ provider: 'google', callbackURL: resolvedCallbackURL })
    } catch (err: any) {
      logger.error('Google social sign-in failed', { error: err })
      setErrorMessage(copy.auth.error.default.description)
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
