'use client'

import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'

type WidgetStateMessageProps = {
  message: string
  variant?: 'neutral' | 'status' | 'error'
  onRetry?: () => void
  isRetrying?: boolean
}

export function WidgetStateMessage({
  message,
  variant = 'neutral',
  onRetry,
  isRetrying = false,
}: WidgetStateMessageProps) {
  const copy = useMessages().workspace.widgets.stateMessage

  return (
    <div
      className='flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground text-xs'
      role={variant === 'error' ? 'alert' : variant === 'status' ? 'status' : undefined}
      aria-live={variant === 'status' ? 'polite' : undefined}
      aria-atomic={variant === 'neutral' ? undefined : 'true'}
      aria-busy={isRetrying || undefined}
    >
      <p className={variant === 'error' ? 'text-destructive' : undefined}>{message}</p>
      {variant === 'error' && onRetry ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={onRetry}
          disabled={isRetrying}
          focusableWhenDisabled={isRetrying}
        >
          {isRetrying ? copy.retrying : copy.retry}
        </Button>
      ) : null}
    </div>
  )
}
