import { getLocale } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { WaitlistForm } from '@/app/(auth)/waitlist/waitlist-form'
import { Link, redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

export default async function WaitlistPage() {
  const [registrationMode, locale] = await Promise.all([
    getRegistrationModeForRender(),
    getLocale(),
  ])
  const copy = getPublicCopy(locale as LocaleCode)
  const commonCopy = copy.auth.common
  const waitlistCopy = copy.auth.waitlist
  const disabledCopy = copy.auth.disabled

  if (registrationMode === 'open') {
    redirect({ href: '/signup', locale: locale as LocaleCode })
  }

  if (registrationMode === 'disabled') {
    return (
      <div className='space-y-6 text-center'>
        <AuthPageHeader
          eyebrow={waitlistCopy.eyebrow}
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
    <div>
      <AuthPageHeader
        eyebrow={waitlistCopy.eyebrow}
        title={waitlistCopy.title}
        description={waitlistCopy.description}
      />
      <WaitlistForm />
    </div>
  )
}
