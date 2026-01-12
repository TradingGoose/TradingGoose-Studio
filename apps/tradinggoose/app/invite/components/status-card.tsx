'use client'

import { AlertCircle, CheckCircle2, Mail, RotateCcw, ShieldX, UserPlus, Users2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useBrandConfig } from '@/lib/branding/branding'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

interface InviteStatusCardProps {
  type: 'login' | 'loading' | 'error' | 'success' | 'invitation' | 'warning'
  title: string
  description: string | React.ReactNode
  icon?: 'userPlus' | 'mail' | 'users' | 'error' | 'success' | 'warning'
  actions?: Array<{
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'ghost'
    disabled?: boolean
    loading?: boolean
  }>
  isExpiredError?: boolean
}

const iconMap = {
  userPlus: UserPlus,
  mail: Mail,
  users: Users2,
  error: ShieldX,
  success: CheckCircle2,
  warning: AlertCircle,
}

const iconColorMap = {
  userPlus: 'text-primary',
  mail: 'text-primary',
  users: 'text-primary',
  error: 'text-red-500 dark:text-red-400',
  success: 'text-green-500 dark:text-green-400',
  warning: 'text-yellow-600 dark:text-yellow-500',
}

const iconBgMap = {
  userPlus: 'bg-[var(--primary)]/10',
  mail: 'bg-[var(--primary)]/10',
  users: 'bg-[var(--primary)]/10',
  error: 'bg-red-50 dark:bg-red-950/20',
  success: 'bg-green-50 dark:bg-green-950/20',
  warning: 'bg-yellow-50 dark:bg-yellow-950/20',
}

export function InviteStatusCard({
  type,
  title,
  description,
  icon,
  actions = [],
  isExpiredError = false,
}: InviteStatusCardProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  if (type === 'loading') {
    return (
      <div className={`${soehne.className} space-y-6`}>
        <div className='space-y-1 text-center'>
          <h1 className='font-medium text-[32px] text-black tracking-tight'>Loading</h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            {description}
          </p>
        </div>
        <div className='flex w-full items-center justify-center py-8'>
          <LoadingAgent size='lg' />
        </div>

        <div
          className={`${inter.className} text-muted-foreground fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
        >
          Need help?{' '}
          <a
            href='mailto:help@tradinggoose.ai'
            className='hover:text-primary underline underline-offset-4'
          >
            Contact support
          </a>
        </div>
      </div>
    )
  }

  const IconComponent = icon ? iconMap[icon] : null
  const iconColor = icon ? iconColorMap[icon] : ''
  const iconBg = icon ? iconBgMap[icon] : ''

  return (
    <div className={`${soehne.className} space-y-6`}>
      <div className='space-y-1 text-center'>
        <h1 className='font-medium text-[32px] text-black tracking-tight'>{title}</h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          {description}
        </p>
      </div>

      <div className={`${inter.className} mt-8 space-y-8`}>
        <div className='flex w-full flex-col gap-3'>
          {isExpiredError && (
            <Button
              variant='outline'
              className='w-full rounded-md border-primary font-medium text-[15px] text-primary transition-colors duration-200 hover:bg-primary hover:text-black'
              onClick={() => router.push('/')}
            >
              <RotateCcw className='mr-2 h-4 w-4' />
              Request New Invitation
            </Button>
          )}

          {actions.map((action, index) => (
            <Button
              key={index}
              variant={action.variant || 'default'}
              className={
                (action.variant || 'default') === 'default'
                  ? primaryButtonClasses
                  : action.variant === 'outline'
                    ? 'w-full rounded-md border-primary font-medium text-[15px] text-primary transition-colors duration-200 hover:bg-primary hover:text-black'
                    : 'w-full rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'
              }
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
            >
              {action.loading ? (
                <>
                  <LoadingAgent size='sm' />
                  {action.label}...
                </>
              ) : (
                action.label
              )}
            </Button>
          ))}
        </div>
      </div>

      <div
        className={`${inter.className} text-muted-foreground fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
      >
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='hover:text-primary underline underline-offset-4'
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
