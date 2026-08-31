import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground [&:not([data-disabled])]:hover:bg-primary-hover',
        destructive:
          'bg-destructive text-destructive-foreground [&:not([data-disabled])]:hover:bg-destructive/90',
        outline:
          'border border-input [&:not([data-disabled])]:hover:bg-muted [&:not([data-disabled])]:hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground [&:not([data-disabled])]:hover:bg-secondary/80',
        ghost:
          'bg-muted/40 [&:not([data-disabled])]:hover:bg-muted [&:not([data-disabled])]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [&:not([data-disabled])]:hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-sm px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return <ButtonPrimitive className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
