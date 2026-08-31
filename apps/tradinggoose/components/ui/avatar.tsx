'use client'

import * as React from 'react'
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@/lib/utils'

const Avatar = React.forwardRef<HTMLSpanElement, AvatarPrimitive.Root.Props>(
  ({ className, ...props }, ref) => (
    <AvatarPrimitive.Root
      data-slot='avatar'
      ref={ref}
      className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  )
)
Avatar.displayName = 'Avatar'

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarPrimitive.Image.Props>(
  ({ className, ...props }, ref) => (
    <AvatarPrimitive.Image
      data-slot='avatar-image'
      ref={ref}
      className={cn('aspect-square h-full w-full object-center', className)}
      {...props}
    />
  )
)
AvatarImage.displayName = 'AvatarImage'

const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarPrimitive.Fallback.Props>(
  ({ className, ...props }, ref) => (
    <AvatarPrimitive.Fallback
      data-slot='avatar-fallback'
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full text-accent-foreground text-xs',
        className
      )}
      {...props}
    />
  )
)
AvatarFallback.displayName = 'AvatarFallback'

export { Avatar, AvatarImage, AvatarFallback }
