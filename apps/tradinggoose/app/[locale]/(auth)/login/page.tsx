import { getLocale } from 'next-intl/server'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import { getSession } from '@/lib/auth'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { redirect } from '@/i18n/navigation'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const [locale, session] = await Promise.all([
    getLocale(),
    getSession(),
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
