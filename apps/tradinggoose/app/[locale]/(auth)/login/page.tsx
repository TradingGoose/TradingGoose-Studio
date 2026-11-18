import { getLocale } from 'next-intl/server'
import { getSession } from '@/lib/auth'
import { getOAuthProviderAvailability } from '@/lib/oauth/oauth.server'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import LoginForm from '@/app/(auth)/login/login-form'
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

  const [{ github, google }, registrationMode] = await Promise.all([
    getOAuthProviderAvailability(['github', 'google']),
    getRegistrationModeForRender(),
  ])

  return (
    <LoginForm
      githubAvailable={github}
      googleAvailable={google}
      registrationMode={registrationMode}
    />
  )
}
