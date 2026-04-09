import Link from 'next/link'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { Button } from '@/components/ui/button'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { REGISTRATION_DISABLED_MESSAGE } from '@/lib/registration/shared'
import { WaitlistForm } from './waitlist-form'

export const dynamic = 'force-dynamic'

export default async function WaitlistPage() {
  const registrationMode = await getRegistrationModeForRender()

  if (registrationMode === 'disabled') {
    return (
      <div className='space-y-6 text-center'>
        <AuthPageHeader
          eyebrow='Waitlist'
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
    <div>
      <AuthPageHeader
        eyebrow='Waitlist'
        title='Request access to TradingGoose'
        description='Join the queue for platform access. If your email is already approved, you can continue straight to signup from here.'
      />
      <WaitlistForm />
    </div>
  )
}
