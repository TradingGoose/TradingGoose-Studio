'use client'

import * as React from 'react'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// TODO: FIX STYLING
const toggleVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-card hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[pressed]:bg-accent data-[pressed]:text-accent-foreground',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-card hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-3',
        sm: 'h-9 px-2.5',
        lg: 'h-11 px-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

const Toggle = React.forwardRef<
  HTMLButtonElement,
  TogglePrimitive.Props & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive
    data-slot='toggle'
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = 'Toggle'

export { Toggle }
