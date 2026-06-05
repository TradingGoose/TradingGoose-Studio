import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import { getRegistrationModeForRender } from '@/lib/registration/service'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
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
