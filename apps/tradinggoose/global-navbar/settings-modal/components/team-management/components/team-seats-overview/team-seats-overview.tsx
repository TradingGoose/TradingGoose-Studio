import { useLocale } from 'next-intl'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { getPublicCopy, formatTemplate } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

type Subscription = {
  id: string
  status: string
  seats?: number
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: any
  tier?: {
    displayName: string
    ownerType: 'user' | 'organization'
    seatMode: 'fixed' | 'adjustable'
    monthlyPriceUsd: number | null
  } | null
}

interface TeamSeatsOverviewProps {
  subscriptionData: Subscription | null
  isLoadingSubscription: boolean
  usedSeats: number
  isLoading: boolean
  onConfirmTeamUpgrade: (seats: number) => Promise<void>
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
  subscriptionData,
  isLoadingSubscription,
  usedSeats,
  isLoading,
  onConfirmTeamUpgrade,
  onReduceSeats,
  onAddSeatDialog,
}: TeamSeatsOverviewProps) {
  const locale = useLocale() as LocaleCode
  const teamCopy = getPublicCopy(locale).workspace.settingsModal.team
  const canManageSeats =
    subscriptionData?.tier?.ownerType === 'organization' &&
    subscriptionData?.tier?.seatMode === 'adjustable'
  const pricePerSeat = subscriptionData?.tier?.monthlyPriceUsd ?? 0

  if (isLoadingSubscription) {
    return <TeamSeatsSkeleton />
  }

  if (!subscriptionData) {
    return (
      <div className='rounded-sm border bg-background p-3 shadow-xs'>
        <div className='space-y-4 text-center'>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100'>
            <Building2 className='h-6 w-6 text-yellow-600' />
          </div>
          <div className='space-y-2'>
            <p className='font-medium text-sm'>{teamCopy.noTeamSubscriptionFound}</p>
            <p className='text-muted-foreground text-sm'>
              {teamCopy.subscriptionMayNeedTransfer}
            </p>
          </div>
          <Button
            onClick={() => {
              onConfirmTeamUpgrade(2) // Start with 2 seats as default
            }}
            disabled={isLoading}
            className='h-9 rounded-sm'
          >
            {teamCopy.setUpTeamSubscription}
          </Button>
        </div>
      </div>
    )
  }

  if (!canManageSeats) {
    return null
  }

  return (
    <div className='rounded-sm border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-sm'>{teamCopy.seats}</span>
            <span className='text-muted-foreground text-xs'>
              {formatTemplate(teamCopy.pricePerSeat, { price: pricePerSeat })}
            </span>
          </div>
          <div className='flex items-center gap-1 text-xs tabular-nums'>
            <span className='text-muted-foreground'>
              {formatTemplate(teamCopy.used, { count: usedSeats })}
            </span>
            <span className='text-muted-foreground'>/</span>
            <span className='text-muted-foreground'>
              {formatTemplate(teamCopy.total, { count: subscriptionData.seats || 0 })}
            </span>
          </div>
        </div>

        <Progress value={(usedSeats / (subscriptionData.seats || 1)) * 100} className='h-2' />

        <div className='flex gap-2 pt-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={onReduceSeats}
            disabled={(subscriptionData.seats || 0) <= 1 || isLoading}
            className='h-8 flex-1 rounded-sm'
          >
            {teamCopy.removeSeat}
          </Button>
          <Button
            size='sm'
            onClick={onAddSeatDialog}
            disabled={isLoading}
            className='h-8 flex-1 rounded-sm'
          >
            {teamCopy.addSeat}
          </Button>
        </div>
      </div>
    </div>
  )
}
