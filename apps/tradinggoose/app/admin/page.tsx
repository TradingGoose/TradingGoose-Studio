import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ADMIN_META_BADGE_CLASSNAME } from './badge-styles'
import { AdminPageShell } from './page-shell'
import { AdminSystemSettingsSection } from './system-settings-section'

export default function AdminHomePage() {
  return (
    <AdminPageShell
      left={
        <div className='flex items-center gap-2'>
          <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
            Admin
          </Badge>
          <span>System Overview</span>
        </div>
      }
    >
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-6'>
        <div className='space-y-2'>
          <h1 className='font-semibold text-2xl tracking-tight'>System administration</h1>
          <p className='max-w-2xl text-muted-foreground'>
            Manage system-owned integrations, credentials, and platform-wide configuration from a
            dedicated admin area.
          </p>
        </div>

        <AdminSystemSettingsSection />

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>Billing</CardTitle>
              <CardDescription>
                Manage plans, pricing, base charges, and customer-facing billing limits.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>
                Open the billing area to create tiers, update pricing, and manage company-wide
                billing settings.
              </p>
              <Button asChild>
                <Link href='/admin/billing'>Open</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Services</CardTitle>
              <CardDescription>
                Configure system-owned API credentials for search, embeddings, OCR, and browser
                automation.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>
                Manage platform-wide service credentials without mixing them into OAuth
                integrations.
              </p>
              <Button asChild>
                <Link href='/admin/services'>Open</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>
                Configure system-managed OAuth integrations and provider bundles.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>
                Manage OAuth-backed integration bundles separately from system service
                credentials.
              </p>
              <Button asChild>
                <Link href='/admin/integrations'>Open</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registration</CardTitle>
              <CardDescription>
                Control public signup mode and review the waitlist queue.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-muted-foreground text-sm'>
                Switch between open access, waitlist approval, or fully disabled registration.
              </p>
              <Button asChild>
                <Link href='/admin/registration'>Open</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPageShell>
  )
}
