import { getLocale } from 'next-intl/server'
import { UsernameForm } from '@/components/auth/username-form'
import { buttonVariants } from '@/components/ui/button'
import { getSession } from '@/lib/auth'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'
import { Link, redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { normalizeCallbackUrl } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{ invite_flow?: string; complete?: string; callbackUrl?: string }>
}) {
  const [locale, session] = await Promise.all([getLocale(), getSession()])

  const resolvedSearchParams = (await searchParams) ?? {}
  if (session?.user?.id || resolvedSearchParams.complete === 'username') {
    const destination = normalizeCallbackUrl(resolvedSearchParams.callbackUrl) ?? '/workspace'
    if (!session?.user?.id) {
      return redirect({ href: `/login?callbackUrl=${encodeURIComponent(destination)}`, locale })
    }
    if (session.user.username) return redirect({ href: destination, locale })

    const { username } = getPublicCopy(locale).workspace.settingsModal.account
    return (
      <>
        <h1 className='text-center font-medium text-3xl'>{username.choose}</h1>
        <UsernameForm destination={destination} />
      </>
    )
  }

  const providers = await Promise.all([getOAuthProviderStatus(), getRegistrationModeForRender()])
  const [{ githubAvailable, googleAvailable, isProduction }, registrationMode] = providers
  const copy = getPublicCopy(locale)
  const commonCopy = copy.auth.common
  const disabledCopy = copy.auth.disabled
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
          <Link href='/login' className={buttonVariants()}>
            {commonCopy.backToLogin}
          </Link>
          <Link href='/' className={buttonVariants({ variant: 'outline' })}>
            {commonCopy.returnHome}
          </Link>
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
