'use client'

import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type CheckboxProps = Omit<CheckboxPrimitive.Root.Props, 'children' | 'nativeButton' | 'render'>

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      ref={ref}
      nativeButton
      render={<button />}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot='checkbox-indicator'
        className={cn('flex items-center justify-center text-current')}
      >
        <Check className='h-3.5 w-3.5 stroke-[3]' />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
