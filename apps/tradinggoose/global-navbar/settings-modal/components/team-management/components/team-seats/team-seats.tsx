import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'

interface TeamSeatsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tier: Pick<
    PublicBillingTierDisplay,
    'displayName' | 'seatCount' | 'seatMaximum' | 'monthlyPriceUsd'
  >
  usedSeats?: number
  currentSeats?: number
  initialSeats?: number
  isLoading: boolean
  error?: string | null
  onConfirm: (seats: number) => Promise<void>
  showCostBreakdown?: boolean
  isCancelledAtPeriodEnd?: boolean
}

export function TeamSeats({
  open,
  onOpenChange,
  tier,
  usedSeats = 0,
  currentSeats,
  initialSeats,
  isLoading,
  error,
  onConfirm,
  showCostBreakdown = false,
  isCancelledAtPeriodEnd = false,
}: TeamSeatsProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const locale = useLocale()
  const minimumSeats = Math.max(tier.seatCount ?? 1, usedSeats, 1)
  const maximumSeats = tier.seatMaximum
  const exceedsSeatMaximum = maximumSeats !== null && minimumSeats > maximumSeats
  const clampSeats = (seats: number) =>
    Math.max(minimumSeats, Math.min(seats, maximumSeats ?? Number.POSITIVE_INFINITY))
  const [requestedSeats, setRequestedSeats] = useState<number>()
  const selectedSeats = clampSeats(requestedSeats ?? initialSeats ?? minimumSeats)
  const pricePerSeat = tier.monthlyPriceUsd

  useEffect(() => {
    if (!open) setRequestedSeats(undefined)
    else if (requestedSeats !== undefined && selectedSeats !== requestedSeats) {
      setRequestedSeats(selectedSeats)
    }
  }, [open, requestedSeats, selectedSeats])

  const handleConfirm = async () => {
    if (!exceedsSeatMaximum) await onConfirm(clampSeats(selectedSeats))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isLoading) return details.cancel()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent hideCloseButton={isLoading}>
        <DialogHeader>
          <DialogTitle>{showCostBreakdown ? t('addSeats.title') : tier.displayName}</DialogTitle>
          {pricePerSeat !== null && (
            <DialogDescription>
              {showCostBreakdown
                ? t('addSeats.description', { price: formatUsd(locale, pricePerSeat) })
                : t('pricePerSeat', { price: formatUsd(locale, pricePerSeat) })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className='py-4'>
          <Label htmlFor='seats'>{t('numberOfSeats')}</Label>
          <Input
            id='seats'
            type='number'
            min={minimumSeats}
            max={maximumSeats ?? undefined}
            value={selectedSeats}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              setRequestedSeats(clampSeats(Number.isFinite(parsed) ? parsed : minimumSeats))
            }}
            className='rounded-sm'
            disabled={isLoading || exceedsSeatMaximum}
          />

          {pricePerSeat !== null && (
            <p className='mt-2 text-muted-foreground text-sm'>
              {showCostBreakdown
                ? t('yourTeamWillHave', {
                    count: selectedSeats,
                    cost: formatUsd(locale, selectedSeats * pricePerSeat),
                  })
                : `${formatUsd(locale, selectedSeats * pricePerSeat)}${t('plans.monthly')}`}
            </p>
          )}
          <p className='mt-1 text-muted-foreground text-xs'>
            {exceedsSeatMaximum
              ? t('teamExceedsSeatMaximum', {
                  used: formatLocalizedNumber(locale, usedSeats),
                  maximum: formatLocalizedNumber(locale, maximumSeats),
                })
              : maximumSeats === null
                ? t('minimumSeatsNoMax', {
                    minimum: formatLocalizedNumber(locale, minimumSeats),
                  })
                : t('chooseBetweenSeats', {
                    minimum: formatLocalizedNumber(locale, minimumSeats),
                    maximum: formatLocalizedNumber(locale, maximumSeats),
                  })}
          </p>

          {showCostBreakdown && currentSeats !== undefined && (
            <div className='mt-3 rounded-md bg-muted/50 p-3'>
              <div className='flex justify-between text-sm'>
                <span>{t('currentSeats')}</span>
                <span>{formatLocalizedNumber(locale, currentSeats)}</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>{t('newSeats')}</span>
                <span>{formatLocalizedNumber(locale, selectedSeats)}</span>
              </div>
              {pricePerSeat !== null && (
                <div className='mt-2 flex justify-between border-t pt-2 font-medium text-sm'>
                  <span>{t('monthlyCostChange')}</span>
                  <span>
                    {formatUsd(locale, (selectedSeats - currentSeats) * pricePerSeat, {
                      signDisplay: 'exceptZero',
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('cancel')}
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span>
                    <Button
                      onClick={handleConfirm}
                      disabled={
                        isLoading ||
                        exceedsSeatMaximum ||
                        (showCostBreakdown && selectedSeats === currentSeats) ||
                        isCancelledAtPeriodEnd
                      }
                      focusableWhenDisabled={isLoading}
                      aria-busy={isLoading || undefined}
                    >
                      {isLoading ? (
                        <div className='flex items-center space-x-2'>
                          <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-b-transparent' />
                          <span>{t('updating')}</span>
                        </div>
                      ) : (
                        <span>
                          {showCostBreakdown ? t('addSeats.confirm') : t('setUpTeamSubscription')}
                        </span>
                      )}
                    </Button>
                  </span>
                }
              />
              {isCancelledAtPeriodEnd && (
                <TooltipContent>
                  <p>{t('reactivateSubscription')}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
