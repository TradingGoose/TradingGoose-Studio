import { getLocale } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getBillingGateState } from '@/lib/billing/settings'
import { ADMIN_META_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import { AdminSystemSettingsSection } from '@/app/admin/system-settings-section'
import { Link } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export default async function AdminHomePage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale).admin.home
  const { stripeConfigured } = await getBillingGateState()

  return (
    <AdminPageShell
      left={
        <div className='flex items-center gap-2'>
          <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
            {copy.badge}
          </Badge>
          <span>{copy.systemOverview}</span>
        </div>
      }
    >
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-6'>
        <div className='space-y-2'>
          <h1 className='font-semibold text-2xl tracking-tight'>{copy.title}</h1>
          <p className='max-w-2xl text-muted-foreground'>{copy.description}</p>
        </div>

        <AdminSystemSettingsSection />

        <div className='grid gap-4 md:grid-cols-2'>
          {stripeConfigured ? (
            <Card>
              <CardHeader>
                <CardTitle>{copy.cards.billing.title}</CardTitle>
                <CardDescription>{copy.cards.billing.description}</CardDescription>
              </CardHeader>
              <CardContent className='flex items-center justify-between gap-4'>
                <p className='text-muted-foreground text-sm'>{copy.cards.billing.body}</p>
                <Link href='/admin/billing' className={buttonVariants()}>
                  {copy.cards.billing.action}
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{copy.cards.services.title}</CardTitle>
              <CardDescription>{copy.cards.services.description}</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>{copy.cards.services.body}</p>
              <Link href='/admin/services' className={buttonVariants()}>
                {copy.cards.services.action}
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.cards.integrations.title}</CardTitle>
              <CardDescription>{copy.cards.integrations.description}</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>{copy.cards.integrations.body}</p>
              <Link href='/admin/integrations' className={buttonVariants()}>
                {copy.cards.integrations.action}
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.cards.registration.title}</CardTitle>
              <CardDescription>{copy.cards.registration.description}</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>{copy.cards.registration.body}</p>
              <Link href='/admin/registration' className={buttonVariants()}>
                {copy.cards.registration.action}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPageShell>
  )
}
