'use client'

import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PrimaryButtonProps extends Omit<ButtonProps, 'size'> {
  size?: 'sm' | 'default' | 'lg'
}

export function PrimaryButton({
  children,
  disabled = false,
  size = 'sm',
  className,
  type = 'button',
  ...props
}: PrimaryButtonProps) {
  return (
    <Button
      disabled={disabled}
      size={size}
      type={type}
      className={cn(
        'flex items-center gap-1 bg-primary font-[480] text-black shadow-[0_0_0_0_var(--primary)] transition-all duration-200 hover:bg-primary-hover ',
        disabled && 'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}
