import { getLocale } from 'next-intl/server'
import { Link, redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'
import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/auth'
import { getRegistrationModeForRender } from '@/lib/registration/service'

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{ invite_flow?: string }>
}) {
  const [locale, session] = await Promise.all([
    getLocale(),
    getSession(undefined, { disableCookieCache: true }),
  ])

  if (session?.user?.id) {
    redirect({ href: '/workspace', locale })
  }

  const providers = await Promise.all([getOAuthProviderStatus(), getRegistrationModeForRender()])
  const [{ githubAvailable, googleAvailable, isProduction }, registrationMode] = providers
  const copy = getPublicCopy(locale)
  const commonCopy = copy.auth.common
  const disabledCopy = copy.auth.disabled
  const resolvedSearchParams = (await searchParams) ?? {}
  const isInviteFlow = resolvedSearchParams.invite_flow === 'true'

  if (registrationMode === 'disabled' && !isInviteFlow) {
    return (
      <div className='space-y-6 text-center'>
        <AuthPageHeader
          eyebrow={copy.auth.signup.eyebrow}
          title={disabledCopy.title}
          description={disabledCopy.description}
        />
        <div className='flex items-center justify-center gap-3'>
          <Button asChild>
            <Link href='/login'>{commonCopy.backToLogin}</Link>
          </Button>
          <Button variant='outline' asChild>
            <Link href='/'>{commonCopy.returnHome}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
      registrationMode={registrationMode}
    />
  )
}
