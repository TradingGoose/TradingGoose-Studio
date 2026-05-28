'use client'

import { cn } from '@/lib/utils'
import { useDeploymentCopy } from '@/widgets/widgets/editor_workflow/copy'

interface DeployStatusProps {
  needsRedeployment: boolean
}

export function DeployStatus({ needsRedeployment }: DeployStatusProps) {
  const copy = useDeploymentCopy()
  return (
    <div className='flex items-center gap-1'>
      <span className='font-medium text-muted-foreground text-xs'>{copy.status}</span>
      <div className='flex items-center gap-1.5'>
        <div className='relative flex items-center justify-center'>
          {needsRedeployment ? (
            <>
              <div className='absolute h-3 w-3 animate-ping rounded-full bg-yellow-500/20' />
              <div className='relative h-2 w-2 rounded-full bg-yellow-500' />
            </>
          ) : (
            <>
              <div className='absolute h-3 w-3 animate-ping rounded-full bg-green-500/20' />
              <div className='relative h-2 w-2 rounded-full bg-green-500' />
            </>
          )}
        </div>
        <span
          className={cn(
            'font-medium text-xs',
            needsRedeployment
              ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400'
              : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
          )}
        >
          {needsRedeployment ? copy.changesDetected : copy.active}
        </span>
      </div>
    </div>
  )
}
