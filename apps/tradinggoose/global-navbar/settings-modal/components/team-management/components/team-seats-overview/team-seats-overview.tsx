import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { OrganizationSeats } from '@/hooks/queries/organization'
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'

interface TeamSeatsOverviewProps {
  totalSeats: number
  seatQuote: OrganizationSeats['seatQuote']
  isLoadingSubscription: boolean
  usedSeats: number
  actionsDisabled: boolean
  isReducing: boolean
  error?: string | null
  onReduceSeats: () => Promise<void>
  onAddSeatDialog: () => void
}

function TeamSeatsSkeleton() {
  return (
    <div className='rounded-sm border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-5 w-16' />
            <Skeleton className='h-4 w-20' />
          </div>
          <div className='flex items-center gap-1 text-xs'>
            <Skeleton className='h-4 w-8' />
            <span className='text-muted-foreground'>/</span>
            <Skeleton className='h-4 w-8' />
          </div>
        </div>
        <Skeleton className='h-2 w-full rounded' />
        <div className='flex gap-2 pt-1'>
          <Skeleton className='h-8 flex-1 rounded-sm' />
          <Skeleton className='h-8 flex-1 rounded-sm' />
        </div>
      </div>
    </div>
  )
}

export function TeamSeatsOverview({
  totalSeats,
  seatQuote,
  isLoadingSubscription,
  usedSeats,
  actionsDisabled,
  isReducing,
  error,
  onReduceSeats,
  onAddSeatDialog,
}: TeamSeatsOverviewProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const locale = useLocale()

  if (isLoadingSubscription) {
    return <TeamSeatsSkeleton />
  }

  return (
    <div className='rounded-sm border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-sm'>{t('seats')}</span>
            {seatQuote && (
              <span className='text-muted-foreground text-xs'>
                {t('pricePerSeat', {
                  price: formatUsd(locale, seatQuote.amountUsd),
                  interval: seatQuote.interval,
                })}
              </span>
            )}
          </div>
          <div className='flex items-center gap-1 text-xs tabular-nums'>
            <span className='text-muted-foreground'>
              {t('used', { count: formatLocalizedNumber(locale, usedSeats) })}
            </span>
            <span className='text-muted-foreground'>/</span>
            <span className='text-muted-foreground'>
              {t('total', { count: formatLocalizedNumber(locale, totalSeats) })}
            </span>
          </div>
        </div>

        <Progress value={(usedSeats / Math.max(totalSeats, 1)) * 100} className='h-2' />

        {error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className='flex gap-2 pt-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={onReduceSeats}
            disabled={totalSeats <= 1 || actionsDisabled}
            focusableWhenDisabled={isReducing}
            aria-busy={isReducing || undefined}
            className='h-8 flex-1 rounded-sm'
          >
            {isReducing ? t('removingSeat') : t('removeSeat')}
          </Button>
          <Button
            size='sm'
            onClick={onAddSeatDialog}
            disabled={actionsDisabled}
            className='h-8 flex-1 rounded-sm'
          >
            {t('addSeat')}
          </Button>
        </div>
      </div>
    </div>
  )
}
