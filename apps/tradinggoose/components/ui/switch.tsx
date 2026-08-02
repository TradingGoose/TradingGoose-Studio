'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

type SwitchProps = Omit<SwitchPrimitive.Root.Props, 'children' | 'nativeButton' | 'render'>

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    data-slot='switch'
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[checked]:bg-primary data-[unchecked]:bg-input data-[disabled]:opacity-50',
      className
    )}
    {...props}
    ref={ref}
    nativeButton
    render={<button />}
  >
    <SwitchPrimitive.Thumb
      data-slot='switch-thumb'
      className='pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0'
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

export { Switch }
