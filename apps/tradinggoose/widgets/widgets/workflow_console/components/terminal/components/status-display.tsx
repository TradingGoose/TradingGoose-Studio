'use client'

import { Badge } from '@/components/ui/badge'

interface StatusDisplayProps {
  isRunning: boolean
  isCanceled: boolean
  formattedDuration: string
}

export function StatusDisplay({
  isRunning,
  isCanceled,
  formattedDuration,
}: StatusDisplayProps) {
  if (isRunning) {
    return (
      <Badge className='bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'>
        Running
      </Badge>
    )
  }

  if (isCanceled) {
    return <span className='text-xs text-muted-foreground'>canceled</span>
  }

  return <span className='text-xs text-muted-foreground'>{formattedDuration}</span>
}
