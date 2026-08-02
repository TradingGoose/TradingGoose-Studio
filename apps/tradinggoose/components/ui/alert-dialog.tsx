'use client'

import * as React from 'react'
import { Dialog as AlertDialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type StaticClassNameProps<Props> = Omit<Props, 'className'> & { className?: string }

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger

type AlertDialogContentProps = StaticClassNameProps<AlertDialogPrimitive.Popup.Props> & {
  hideCloseButton?: boolean
}

const AlertDialogContent = React.forwardRef<HTMLDivElement, AlertDialogContentProps>(
  ({ className, children, hideCloseButton = false, ...props }, ref) => (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        data-slot='alert-dialog-backdrop'
        className='data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-[1.5px] data-[ending-style]:animate-out data-[starting-style]:animate-in'
      />
      <AlertDialogPrimitive.Viewport className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4'>
        <AlertDialogPrimitive.Popup
          ref={ref}
          role='alertdialog'
          className={cn(
            'data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 pointer-events-auto relative grid w-full max-w-xl gap-4 rounded-lg border border-border bg-background px-6 py-5 shadow-lg duration-200 data-[ending-style]:animate-out data-[starting-style]:animate-in',
            className
          )}
          {...props}
        >
          {children}
          {!hideCloseButton && (
            <AlertDialogPrimitive.Close className='absolute top-4 right-4 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </AlertDialogPrimitive.Close>
          )}
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  )
)
AlertDialogContent.displayName = 'AlertDialogContent'

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  StaticClassNameProps<AlertDialogPrimitive.Title.Props>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('font-semibold text-lg', className)}
    {...props}
  />
))
AlertDialogTitle.displayName = 'AlertDialogTitle'

const AlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  StaticClassNameProps<AlertDialogPrimitive.Description.Props>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('font-[360] text-sm', className)}
    {...props}
  />
))
AlertDialogDescription.displayName = 'AlertDialogDescription'

const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  StaticClassNameProps<AlertDialogPrimitive.Close.Props>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Close ref={ref} className={cn(buttonVariants(), className)} {...props} />
))
AlertDialogAction.displayName = 'AlertDialogAction'

const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  StaticClassNameProps<AlertDialogPrimitive.Close.Props>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Close
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', className)}
    {...props}
  />
))
AlertDialogCancel.displayName = 'AlertDialogCancel'

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
