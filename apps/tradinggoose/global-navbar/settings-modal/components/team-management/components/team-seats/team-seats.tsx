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
import type { OrganizationSeats } from '@/hooks/queries/organization'
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'

interface TeamSeatsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seatPrice: OrganizationSeats['seatPrice']
  minimumSeats: number
  maximumSeats: number | null
  currentSeats: number
  isLoading: boolean
  error?: string | null
  onConfirm: (seats: number) => Promise<void>
}

export function TeamSeats({
  open,
  onOpenChange,
  seatPrice,
  minimumSeats,
  maximumSeats,
  currentSeats,
  isLoading,
  error,
  onConfirm,
}: TeamSeatsProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const locale = useLocale()
  const [seatDraft, setSeatDraft] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setSeatDraft(null)
  }, [open])

  const boundedInitialSeats = Math.max(
    minimumSeats,
    Math.min(currentSeats + 1, maximumSeats ?? Number.POSITIVE_INFINITY)
  )
  const inputValue = seatDraft ?? String(boundedInitialSeats)
  const selectedSeats = Number(inputValue)
  const invalidRange = maximumSeats !== null && minimumSeats > maximumSeats
  const validQuantity =
    inputValue !== '' &&
    Number.isSafeInteger(selectedSeats) &&
    selectedSeats >= minimumSeats &&
    (maximumSeats === null || selectedSeats <= maximumSeats)
  const canQuote = validQuantity && seatPrice !== null
  const canConfirm = !isLoading && canQuote && selectedSeats !== currentSeats
  const handleConfirm = async () => {
    if (canConfirm) await onConfirm(selectedSeats)
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
          <DialogTitle>{t('addSeats.title')}</DialogTitle>
          <DialogDescription>
            {seatPrice
              ? t('addSeats.description', {
                  price: formatUsd(locale, seatPrice.amountUsd),
                  interval: seatPrice.interval,
                })
              : t('addSeats.quoteUnavailable')}
          </DialogDescription>
        </DialogHeader>

        <div className='py-4'>
          <Label htmlFor='seats'>{t('numberOfSeats')}</Label>
          <Input
            id='seats'
            type='number'
            min={minimumSeats}
            max={maximumSeats ?? undefined}
            value={inputValue}
            onChange={(event) => setSeatDraft(event.target.value)}
            className='rounded-sm'
            disabled={isLoading}
          />

          {canQuote && (
            <p className='mt-2 text-muted-foreground text-sm'>
              {t('yourTeamWillHave', {
                count: selectedSeats,
                cost: formatUsd(locale, selectedSeats * seatPrice.amountUsd),
                interval: seatPrice.interval,
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

          {canQuote && (
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
                <span>{t('costChange', { interval: seatPrice.interval })}</span>
                <span>
                  {formatUsd(locale, (selectedSeats - currentSeats) * seatPrice.amountUsd, {
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
            disabled={!canConfirm}
            focusableWhenDisabled={isLoading}
            aria-busy={isLoading || undefined}
          >
            {isLoading ? (
              <div className='flex items-center space-x-2'>
                <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-b-transparent' />
                <span>{t('updating')}</span>
              </div>
            ) : (
              t('addSeats.confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
