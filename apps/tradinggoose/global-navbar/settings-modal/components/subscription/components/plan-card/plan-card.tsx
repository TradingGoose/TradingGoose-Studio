'use client'

import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button, Input, Label } from '@/components/ui'
import type { ButtonProps } from '@/components/ui/button'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { cn } from '@/lib/utils'
import { useOrganizationSeats } from '@/hooks/queries/organization'

export interface PlanFeature {
  icon: LucideIcon
  text: string
}

type CheckoutSeatBounds = { organizationId: string; minimum: number; maximum: number | null }

export function getCheckoutSeatBounds(
  tier: PublicBillingTierDisplay,
  organizationId: string | undefined,
  hasCurrentTier: boolean
): CheckoutSeatBounds | undefined {
  if (!organizationId || hasCurrentTier || tier.seatMode !== 'adjustable') return
  return { organizationId, minimum: tier.seatCount ?? 1, maximum: tier.seatMaximum }
}

type PlanButtonProps = Pick<ButtonProps, 'className' | 'variant' | 'disabled' | 'children'> & {
  seatBounds?: CheckoutSeatBounds
  showSeatRetry?: boolean
  onSelect: (seats?: number) => void
}

export function PlanButton({ seatBounds, onSelect, showSeatRetry, ...button }: PlanButtonProps) {
  const t = useTranslations('workspace.settingsModal.team')
  const retryCopy = useTranslations('workspace.permissionsFeedback')
  const seats = useOrganizationSeats(seatBounds?.organizationId ?? '')
  if (!seatBounds) return <Button {...button} onClick={() => onSelect()} />
  if (!seats.isSuccess) {
    return seats.isError && showSeatRetry ? (
      <div role='alert' className='space-y-2 text-xs'>
        <p>{t('errors.loadOrganizationBilling')}</p>
        <Button variant='outline' disabled={seats.isFetching} onClick={() => void seats.refetch()}>
          {retryCopy('retry')}
        </Button>
      </div>
    ) : (
      <Button {...button} disabled />
    )
  }
  const minimum = Math.max(seatBounds.minimum, seats.data.usedSeats)
  return (
    <form
      key={seatBounds.organizationId}
      className='space-y-2'
      onSubmit={(event) => {
        event.preventDefault()
        onSelect(Number(new FormData(event.currentTarget).get('seats')))
      }}
    >
      <Label className='block text-xs'>
        {t('numberOfSeats')}
        <Input
          type='number'
          required
          min={minimum}
          max={seatBounds.maximum ?? undefined}
          name='seats'
          defaultValue={minimum}
        />
      </Label>
      <Button {...button} type='submit' />
    </form>
  )
}

interface PlanCardProps {
  name: string
  price?: string
  priceSubtext?: string
  features: PlanFeature[]
  buttonText: string
  seatBounds?: CheckoutSeatBounds
  onButtonClick: (seats?: number) => void
  buttonDisabled?: boolean
  isCurrent?: boolean
  isError?: boolean
  layout?: 'vertical' | 'horizontal'
}

export function PlanCard({
  name,
  price,
  priceSubtext,
  features,
  buttonText,
  onButtonClick,
  seatBounds,
  buttonDisabled = false,
  isCurrent = false,
  isError = false,
  layout = 'vertical',
}: PlanCardProps) {
  const copy = useTranslations('workspace.settingsModal.subscription.planCard')
  const isHorizontal = layout === 'horizontal'
  const actionText = isError ? copy('error') : buttonText

  return (
    <article
      aria-current={isCurrent || undefined}
      className={cn(
        'relative flex rounded-md border p-4 transition-colors',
        isCurrent ? 'border-primary' : 'hover:border-muted-foreground/20',
        isHorizontal ? 'flex-row items-center justify-between' : 'flex-col'
      )}
    >
      <div className={isHorizontal ? undefined : 'mb-4 flex-1'}>
        <header className={isHorizontal ? undefined : 'mb-4'}>
          <h3 className='font-semibold text-sm'>{name}</h3>
          {price && (
            <div className='mt-2 flex items-baseline'>
              <span className='font-semibold text-xl'>{price}</span>
              {priceSubtext && (
                <span className='ml-1 text-muted-foreground text-xs'>{priceSubtext}</span>
              )}
            </div>
          )}
        </header>
        <ul className={isHorizontal ? 'mt-3 flex flex-wrap items-center gap-4' : 'space-y-2'}>
          {features.map(({ icon: Icon, text }, index) => (
            <li
              key={`${text}-${index}`}
              className='flex items-center gap-2 text-muted-foreground text-xs'
            >
              <Icon className='h-3 w-3 shrink-0' />
              {text}
              {isHorizontal && index < features.length - 1 && (
                <span aria-hidden className='ml-4 h-4 w-px bg-border' />
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className={isHorizontal ? 'ml-auto' : undefined}>
        {isCurrent ? (
          <div className='flex h-9 items-center justify-center rounded-sm bg-primary/10 px-4 font-medium text-primary text-xs'>
            {buttonText}
          </div>
        ) : (
          <PlanButton
            showSeatRetry
            seatBounds={seatBounds}
            onSelect={onButtonClick}
            disabled={buttonDisabled}
            className={cn(
              'h-9 rounded-sm text-xs transition-colors',
              isHorizontal ? 'px-4' : 'w-full',
              isError &&
                'border-red-500 bg-transparent text-red-500 hover:bg-red-500 hover:text-white dark:border-red-500 dark:text-red-500 dark:hover:bg-red-500'
            )}
            variant={isError ? 'outline' : 'default'}
          >
            {actionText}
          </PlanButton>
        )}
      </div>
    </article>
  )
}
