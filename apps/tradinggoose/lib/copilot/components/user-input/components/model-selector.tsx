'use client'

import { Check } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { cn } from '@/lib/utils'
import { getProviderIcon } from '@/providers/ai/models'
import { useCopilotStore } from '@/stores/copilot/store'

interface ModelSelectorProps {
  isNearTop: boolean
  panelWidth: number
}

function ModelLabel({ model, className }: { model: string; className?: string }) {
  const modelName = model.split('/').pop() ?? model
  const ProviderIcon = getProviderIcon(modelName)

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {ProviderIcon && (
        <span className='shrink-0 text-muted-foreground' aria-hidden='true'>
          <ProviderIcon className='h-3 w-3' />
        </span>
      )}
      <span className='truncate'>{modelName}</span>
    </span>
  )
}

export function ModelSelector({ isNearTop, panelWidth }: ModelSelectorProps) {
  const { selectedModel, setSelectedModel } = useCopilotStore(
    useShallow((state) => ({
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
    }))
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className='flex h-6 items-center gap-1.5 rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        }
      >
        <ModelLabel
          model={selectedModel}
          className={cn(panelWidth < 360 && 'max-w-[72px] truncate')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
        <div className='w-[160px] p-1'>
          {COPILOT_RUNTIME_MODELS.map((model) => (
            <DropdownMenuItem
              key={model}
              onClick={() => void setSelectedModel(model)}
              className={cn(
                'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                selectedModel === model && 'bg-muted/40'
              )}
            >
              <ModelLabel model={model} />
              {selectedModel === model && <Check className='h-3 w-3 text-muted-foreground' />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
