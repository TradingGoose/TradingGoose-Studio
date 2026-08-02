import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { ADMIN_META_BADGE_CLASSNAME } from '../badge-styles'
import { AdminPageShell } from '../page-shell'
import type { AdminBillingCopy } from './tier-editor'

export function AdminBillingUnavailable({ copy }: { copy: AdminBillingCopy['unavailable'] }) {
  return (
    <AdminPageShell
      left={
        <div className='flex items-center gap-2'>
          <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
            {copy.badge}
          </Badge>
          <span>{copy.label}</span>
        </div>
      }
    >
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent className='flex items-center justify-between gap-4'>
            <p className='text-muted-foreground text-sm'>{copy.requirement}</p>
            <Link href='/admin' className={buttonVariants({ variant: 'outline' })}>
              {copy.back}
            </Link>
          </CardContent>
        </Card>
      </div>
    </AdminPageShell>
  )
}
