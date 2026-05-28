'use client'

import { Badge } from '@/components/ui/badge'
import { useWorkflowConsoleCopy } from '../../../copy'

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
  const copy = useWorkflowConsoleCopy()
  if (isRunning) {
    return (
      <Badge className='bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'>
        {copy.running}
      </Badge>
    )
  }

  if (isCanceled) {
    return <span className='text-xs text-muted-foreground'>{copy.canceled}</span>
  }

  return <span className='text-xs text-muted-foreground'>{formattedDuration}</span>
}
