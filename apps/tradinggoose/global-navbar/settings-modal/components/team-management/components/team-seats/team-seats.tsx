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
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'

interface TeamSeatsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  pricePerSeat: number
  minimumSeats: number
  maximumSeats: number | null
  currentSeats?: number
  initialSeats?: number
  isLoading: boolean
  error?: string | null
  onConfirm: (seats: number) => Promise<void>
  confirmButtonText: string
  showCostBreakdown?: boolean
  isCancelledAtPeriodEnd?: boolean
}

export function TeamSeats({
  open,
  onOpenChange,
  title,
  description,
  pricePerSeat,
  minimumSeats,
  maximumSeats,
  currentSeats,
  initialSeats = 1,
  isLoading,
  error,
  onConfirm,
  confirmButtonText,
  showCostBreakdown = false,
  isCancelledAtPeriodEnd = false,
}: TeamSeatsProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const locale = useLocale()
  const [selectedSeats, setSelectedSeats] = useState(initialSeats)

  useEffect(() => {
    if (open) {
      setSelectedSeats(initialSeats)
    }
  }, [open, initialSeats])

  const totalMonthlyCost = selectedSeats * pricePerSeat
  const costChange = currentSeats ? (selectedSeats - currentSeats) * pricePerSeat : 0
  const handleConfirm = async () => {
    await onConfirm(selectedSeats)
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
              if (!Number.isFinite(parsed)) {
                setSelectedSeats(minimumSeats)
                return
              }

              const nextValue = Math.max(
                minimumSeats,
                maximumSeats === null ? parsed : Math.min(parsed, maximumSeats)
              )
              setSelectedSeats(nextValue)
            }}
            className='rounded-sm'
            disabled={isLoading}
          />

          <p className='mt-2 text-muted-foreground text-sm'>
            {t('yourTeamWillHave', {
              count: selectedSeats,
              cost: formatUsd(locale, totalMonthlyCost),
            })}
          </p>
          <p className='mt-1 text-muted-foreground text-xs'>
            {maximumSeats === null
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
              <div className='mt-2 flex justify-between border-t pt-2 font-medium text-sm'>
                <span>{t('monthlyCostChange')}</span>
                <span>{formatUsd(locale, costChange, { signDisplay: 'exceptZero' })}</span>
              </div>
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
                        <span>{confirmButtonText}</span>
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
