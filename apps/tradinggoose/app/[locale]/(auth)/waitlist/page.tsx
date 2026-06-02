import { getLocale } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { WaitlistForm } from '@/app/(auth)/waitlist/waitlist-form'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { Link, redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

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
