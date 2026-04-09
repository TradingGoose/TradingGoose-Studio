import { redirect } from 'next/navigation'
import { getEnv, isTruthy } from '@/lib/env'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import SSOForm from './sso-form'

export const dynamic = 'force-dynamic'

export default async function SSOPage() {
  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
    redirect('/login')
  }

  const registrationMode = await getRegistrationModeForRender()

  return <SSOForm registrationMode={registrationMode} />
}
