'use client'

import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SaveErrorAlertProps {
  error: string | null | undefined
  className?: string
}

/**
 * Displays a destructive-styled inline alert with an icon.
 * Renders nothing when `error` is falsy.
 */
export function SaveErrorAlert({ error, className }: SaveErrorAlertProps) {
  if (!error) return null

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm',
        className
      )}
    >
      <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
      <span>{error}</span>
    </div>
  )
}
