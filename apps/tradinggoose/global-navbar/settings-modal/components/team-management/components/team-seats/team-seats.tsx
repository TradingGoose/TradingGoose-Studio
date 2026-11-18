import { useCallback, useEffect, useState } from 'react'
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
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'

interface TeamSeatsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  pricePerSeat: number | null
  billingInterval: 'month' | 'year' | null
  minimumSeats: number
  maximumSeats: number | null
  currentSeats?: number
  initialSeats?: number
  isLoading: boolean
  error?: string | null
  onConfirm: (seats: number) => Promise<void>
  confirmButtonText: string
}

export function TeamSeats({
  open,
  onOpenChange,
  title,
  description,
  pricePerSeat,
  billingInterval,
  minimumSeats,
  maximumSeats,
  currentSeats,
  initialSeats = 1,
  isLoading,
  error,
  onConfirm,
  confirmButtonText,
}: TeamSeatsProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const locale = useLocale()
  const clampSeats = useCallback(
    (seats: number) =>
      Math.max(minimumSeats, maximumSeats === null ? seats : Math.min(seats, maximumSeats)),
    [minimumSeats, maximumSeats]
  )
  const [selectedSeats, setSelectedSeats] = useState(() => clampSeats(initialSeats))

  useEffect(() => {
    if (open) {
      setSelectedSeats(clampSeats(initialSeats))
    }
  }, [open, initialSeats, clampSeats])

  const invalidRange = maximumSeats !== null && minimumSeats > maximumSeats
  const handleConfirm = async () => {
    if (invalidRange) return
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

              setSelectedSeats(clampSeats(parsed))
            }}
            className='rounded-sm'
            disabled={isLoading}
          />

          {pricePerSeat !== null && billingInterval && (
            <p className='mt-2 text-muted-foreground text-sm'>
              {t('yourTeamWillHave', {
                count: selectedSeats,
                cost: formatUsd(locale, selectedSeats * pricePerSeat),
                interval: billingInterval,
              })}
            </p>
          )}
          {!invalidRange && (
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
          )}

          {currentSeats !== undefined && pricePerSeat !== null && billingInterval && (
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
                <span>{t('costChange', { interval: billingInterval })}</span>
                <span>
                  {formatUsd(locale, (selectedSeats - currentSeats) * pricePerSeat, {
                    signDisplay: 'exceptZero',
                  })}
                </span>
              </div>
            </div>
          )}
        </div>

        {invalidRange || error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>
              {invalidRange
                ? t('seatCapacityConflict', { minimum: minimumSeats, maximum: maximumSeats })
                : error}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || invalidRange || selectedSeats === currentSeats}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
