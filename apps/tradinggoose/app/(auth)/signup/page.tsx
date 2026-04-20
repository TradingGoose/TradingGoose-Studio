import Link from 'next/link'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'
import { Button } from '@/components/ui/button'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { REGISTRATION_DISABLED_MESSAGE } from '@/lib/registration/shared'

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{ invite_flow?: string }>
}) {
  const [{ githubAvailable, googleAvailable, isProduction }, registrationMode] = await Promise.all([
    getOAuthProviderStatus(),
    getRegistrationModeForRender(),
  ])
  const resolvedSearchParams = (await searchParams) ?? {}
  const isInviteFlow = resolvedSearchParams.invite_flow === 'true'

  if (registrationMode === 'disabled' && !isInviteFlow) {
    return (
      <div className='space-y-6 text-center'>
        <AuthPageHeader
          eyebrow='Sign up'
          title='Registration closed'
          description={REGISTRATION_DISABLED_MESSAGE}
        />
        <div className='flex items-center justify-center gap-3'>
          <Button asChild>
            <Link href='/login'>Login</Link>
          </Button>
          <Button variant='outline' asChild>
            <Link href='/'>Return home</Link>
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
