'use client'

import * as React from 'react'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupPrimitive.Props>(
  ({ className, ...props }, ref) => {
    return (
      <RadioGroupPrimitive
        data-slot='radio-group'
        className={cn('grid gap-2', className)}
        {...props}
        ref={ref}
      />
    )
  }
)
RadioGroup.displayName = 'RadioGroup'

const RadioGroupItem = React.forwardRef<HTMLSpanElement, RadioPrimitive.Root.Props>(
  ({ className, ...props }, ref) => {
    return (
      <RadioPrimitive.Root
        data-slot='radio-group-item'
        ref={ref}
        className={cn(
          'aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          className
        )}
        {...props}
      >
        <RadioPrimitive.Indicator
          data-slot='radio-group-indicator'
          className='flex items-center justify-center'
        >
          <Circle className='h-2.5 w-2.5 fill-current text-current' />
        </RadioPrimitive.Indicator>
      </RadioPrimitive.Root>
    )
  }
)
RadioGroupItem.displayName = 'RadioGroupItem'

export { RadioGroup, RadioGroupItem }
