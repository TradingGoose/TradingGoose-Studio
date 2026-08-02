import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 peer-data-[disabled]:cursor-not-allowed peer-data-[disabled]:opacity-70'
)

const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<'label'> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: Consumers supply htmlFor or nest their control.
  <label ref={ref} className={cn(labelVariants(), className)} {...props} />
))
Label.displayName = 'Label'

export { Label }
