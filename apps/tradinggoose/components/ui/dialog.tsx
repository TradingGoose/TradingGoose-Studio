'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type StaticClassNameProps<Props> = Omit<Props, 'className'> & { className?: string }

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger

type DialogContentProps = StaticClassNameProps<DialogPrimitive.Popup.Props> & {
  hideCloseButton?: boolean
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, hideCloseButton = false, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/50 backdrop-blur-[1.5px] data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:animate-in data-[starting-style]:fade-in-0' />
      <DialogPrimitive.Viewport className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4'>
        <DialogPrimitive.Popup
          ref={ref}
          className={cn(
            'pointer-events-auto relative grid w-full max-w-3xl gap-4 rounded-lg border border-border bg-background p-6 shadow-lg duration-200 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95',
            className
          )}
          {...props}
        >
          {children}
          {!hideCloseButton && (
            <DialogPrimitive.Close className='absolute top-4 right-4 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
)
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  StaticClassNameProps<DialogPrimitive.Title.Props>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-medium text-lg leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  StaticClassNameProps<DialogPrimitive.Description.Props>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
))
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
