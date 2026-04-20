import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ADMIN_META_BADGE_CLASSNAME } from '../badge-styles'
import { AdminPageShell } from '../page-shell'

export function AdminBillingUnavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <AdminPageShell
      left={
        <div className='flex items-center gap-2'>
          <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
            Admin
          </Badge>
          <span>Billing</span>
        </div>
      }
    >
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className='flex items-center justify-between gap-4'>
            <p className='text-muted-foreground text-sm'>
              Configure `STRIPE_SECRET_KEY` in the deployment environment to restore the billing
              admin UI.
            </p>
            <Button asChild variant='outline'>
              <Link href='/admin'>Back</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminPageShell>
  )
}
