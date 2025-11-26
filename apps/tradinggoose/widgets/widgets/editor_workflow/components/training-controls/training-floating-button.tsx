'use client'

import { Database, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'

interface TrainingFloatingButtonProps {
  channelId: string
  isTraining: boolean
  onToggleModal: () => void
  constrainToContainer?: boolean
}

/**
 * Floating button positioned above the diff controls
 * Shows training state and allows starting/stopping training
 */
export function TrainingFloatingButton({
  channelId,
  isTraining,
  onToggleModal,
  constrainToContainer = false,
}: TrainingFloatingButtonProps) {
  const stopTrainingFromSelector = useCopilotTrainingStore(
    (state) => state?.stopTraining ?? (() => null)
  )

  const handleClick = () => {
    if (isTraining) {
      // Stop and save the training session
      const stopTraining = useCopilotTrainingStore.getState?.()?.stopTraining ?? stopTrainingFromSelector
      const dataset = stopTraining(channelId)
      if (dataset) {
        // Show a brief success indicator
        const button = document.getElementById('training-button')
        if (button) {
          button.classList.add('animate-pulse')
          setTimeout(() => button.classList.remove('animate-pulse'), 1000)
        }
      }
    } else {
      // Open modal to start new training via latest store state
      onToggleModal()
    }
  }

  const positionClass = constrainToContainer
    ? 'absolute bottom-16 left-1/2 -translate-x-1/2'
    : 'fixed bottom-32 left-1/2 -translate-x-1/2'

  return (
    <div className={cn(positionClass, 'z-30')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id='training-button'
            variant='outline'
            size='sm'
            onClick={handleClick}
            className={cn(
              'flex items-center gap-2 rounded-sm border bg-card/95 px-3 py-2 shadow-xs backdrop-blur-sm transition-all',
              'hover:bg-card/80',
              isTraining &&
              'border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-950/30'
            )}
          >
            {isTraining ? (
              <>
                <Pause className='h-4 w-4 text-orange-600 dark:text-orange-400' />
                <span className='font-medium text-orange-700 text-sm dark:text-orange-300'>
                  Stop Training
                </span>
              </>
            ) : (
              <>
                <Database className='h-4 w-4' />
                <span className='font-medium text-sm'>Train Copilot</span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isTraining
            ? 'Stop recording and save training dataset'
            : 'Start recording workflow changes for training'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
