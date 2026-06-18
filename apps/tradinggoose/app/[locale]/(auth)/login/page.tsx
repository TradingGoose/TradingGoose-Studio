import { getLocale } from 'next-intl/server'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import { getSession } from '@/lib/auth'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { redirect } from '@/i18n/navigation'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ reauth?: string }>
} = {}) {
  const query = await searchParams
  const isReauth = query?.reauth === '1'
  const [locale, session] = await Promise.all([
    getLocale(),
    isReauth ? Promise.resolve(null) : getSession(),
  ])

  if (session?.user?.id) {
    redirect({ href: '/workspace', locale })
  }

  const [{ githubAvailable, googleAvailable, isProduction }, registrationMode] = await Promise.all([
    getOAuthProviderStatus(),
    getRegistrationModeForRender(),
  ])

  return (
    <LoginForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
      registrationMode={registrationMode}
    />
  )
}
