import { useEffect, useState } from 'react'
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
          <Label htmlFor='seats'>Number of seats</Label>
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
            Your team will have {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} with a
            total of ${totalMonthlyCost} inference credits per month.
          </p>
          <p className='mt-1 text-muted-foreground text-xs'>
            {maximumSeats === null
              ? `Minimum ${minimumSeats} seats. No maximum seat cap applies to this tier.`
              : `Choose between ${minimumSeats} and ${maximumSeats} seats for this tier.`}
          </p>

          {showCostBreakdown && currentSeats !== undefined && (
            <div className='mt-3 rounded-md bg-muted/50 p-3'>
              <div className='flex justify-between text-sm'>
                <span>Current seats:</span>
                <span>{currentSeats}</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>New seats:</span>
                <span>{selectedSeats}</span>
              </div>
              <div className='mt-2 flex justify-between border-t pt-2 font-medium text-sm'>
                <span>Monthly cost change:</span>
                <span>
                  {costChange > 0 ? '+' : ''}${costChange}
                </span>
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
            Cancel
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
                          <span>Updating…</span>
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
                  <p>
                    To update seats, go to Subscription {'>'} Manage {'>'} Keep Subscription to
                    reactivate
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
