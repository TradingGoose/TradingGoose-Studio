'use client'

import * as React from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type StaticClassNameProps<Props> = Omit<Props, 'className'> & { className?: string }

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger

const sheetVariants = cva(
  'pointer-events-auto fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[ending-style]:animate-out data-[ending-style]:duration-300 data-[starting-style]:animate-in data-[starting-style]:duration-500',
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[ending-style]:slide-out-to-left data-[starting-style]:slide-in-from-left sm:max-w-sm',
        right:
          'inset-y-0 right-0 h-full w-3/4 border-l data-[ending-style]:slide-out-to-right data-[starting-style]:slide-in-from-right sm:max-w-sm',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  }
)

interface SheetContentProps
  extends StaticClassNameProps<SheetPrimitive.Popup.Props>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ side = 'right', className, children, ...props }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/50 backdrop-blur-[4.8px] data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:animate-in data-[starting-style]:fade-in-0' />
      <SheetPrimitive.Viewport className='pointer-events-none fixed inset-0 z-50'>
        <SheetPrimitive.Popup
          ref={ref}
          className={cn(sheetVariants({ side }), className)}
          {...props}
        >
          {children}
          <SheetPrimitive.Close className='absolute top-4 right-4 rounded-sm bg-secondary opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none'>
            <X className='h-4 w-4' />
            <span className='sr-only'>Close</span>
          </SheetPrimitive.Close>
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPrimitive.Portal>
  )
)
SheetContent.displayName = 'SheetContent'

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  StaticClassNameProps<SheetPrimitive.Title.Props>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('font-semibold text-foreground text-lg', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  StaticClassNameProps<SheetPrimitive.Description.Props>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
))
SheetDescription.displayName = 'SheetDescription'

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription }
