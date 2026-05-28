import { getLocale } from 'next-intl/server'
import { getEnv, isTruthy } from '@/lib/env'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { redirect } from '@/i18n/navigation'
import { type LocaleCode } from '@/i18n/utils'
import SSOForm from './sso-form'

export const dynamic = 'force-dynamic'

export default async function SSOPage() {
  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
    const locale = (await getLocale()) as LocaleCode
    redirect({ href: '/login', locale })
  }

  const registrationMode = await getRegistrationModeForRender()

  return <SSOForm registrationMode={registrationMode} />
}
