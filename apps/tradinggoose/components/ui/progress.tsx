'use client'

import * as React from 'react'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from '@/lib/utils'

interface ProgressProps extends ProgressPrimitive.Root.Props {
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, indicatorClassName, ...props }, ref) => (
    <ProgressPrimitive.Root
      data-slot='progress'
      ref={ref}
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Track data-slot='progress-track' className='h-full w-full'>
        <ProgressPrimitive.Indicator
          data-slot='progress-indicator'
          className={cn('h-full bg-primary transition-all', indicatorClassName)}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
)
Progress.displayName = 'Progress'

export { Progress }
