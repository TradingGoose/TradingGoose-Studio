import { ADMIN_META_BADGE_CLASSNAME } from './badge-styles'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GlobalNavbarHeader } from '@/global-navbar'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function AdminHomePage() {
  return (
    <div className='h-full overflow-auto bg-background p-6'>
      <GlobalNavbarHeader
        left={
          <div className='flex items-center gap-2'>
            <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>Admin</Badge>
            <span>System Overview</span>
          </div>
        }
      />
      <div className='mx-auto flex max-w-5xl flex-col gap-6'>
        <div className='space-y-2'>
          <h1 className='font-semibold text-2xl tracking-tight'>System administration</h1>
          <p className='max-w-2xl text-muted-foreground'>
            Manage system-owned integrations, credentials, and platform-wide configuration from a
            dedicated admin area.
          </p>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Configure system-level providers, services, and secrets.</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center justify-between gap-4'>
              <p className='text-sm text-muted-foreground'>
                Start with service registration and admin-managed credentials.
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
              <p className='text-sm text-muted-foreground'>
                Switch between open access, waitlist approval, or fully disabled registration.
              </p>
              <Button asChild>
                <Link href='/admin/registration'>Open</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
