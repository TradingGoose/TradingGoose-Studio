'use client'

import { Brain, BrainCircuit, Zap } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { COPILOT_RUNTIME_MODELS, type CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import { deriveCopilotProviderFromModel } from '@/lib/copilot/runtime-provider'
import { cn } from '@/lib/utils'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'

interface ModelSelectorProps {
  isNearTop: boolean
  panelWidth: number
}

const MODEL_PROVIDER_GROUPS = (['anthropic', 'openai'] as const).map((provider) => ({
  provider,
  models: COPILOT_RUNTIME_MODELS.filter(
    (model) => deriveCopilotProviderFromModel(model) === provider
  ),
}))

const MODEL_ICONS = {
  'gpt-5.4': Brain,
  'gpt-5.4-mini': Zap,
  'claude-opus-4.6': BrainCircuit,
  'claude-sonnet-4.6': Brain,
} satisfies Record<CopilotRuntimeModel, typeof Brain>

const getModelOptionIcon = (modelValue: CopilotRuntimeModel) => {
  const Icon = MODEL_ICONS[modelValue]
  return <Icon className='h-3 w-3 text-muted-foreground' />
}

export function ModelSelector({ isNearTop, panelWidth }: ModelSelectorProps) {
  const modelCopy = useCopilotMessages().model
  const { selectedModel, setSelectedModel } = useCopilotStore(
    useShallow((state) => ({
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
    }))
  )

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='outline'
                    size='sm'
                    className='flex h-6 items-center gap-1.5 rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0'
                    aria-label={modelCopy.choose}
                  />
                }
              >
                {getModelOptionIcon(selectedModel)}
                <span className={cn(panelWidth < 360 ? 'max-w-[72px] truncate' : '')}>
                  {selectedModel}
                </span>
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{modelCopy.choose}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={isNearTop ? 'bottom' : 'top'} className='max-h-[400px] p-0'>
        <div className='w-[220px]'>
          <div className='max-h-[280px] overflow-y-auto p-2'>
            <div>
              <div className='mb-1'>
                <span className='font-medium text-xs'>{modelCopy.label}</span>
              </div>
              <div className='space-y-2'>
                {MODEL_PROVIDER_GROUPS.map(({ provider, models }) => (
                  <div key={provider}>
                    <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                      {modelCopy.providers[provider]}
                    </div>
                    <div className='space-y-0.5'>
                      {models.map((model) => (
                        <DropdownMenuItem
                          key={model}
                          onClick={() => void setSelectedModel(model)}
                          className={cn(
                            'flex h-7 items-center gap-1.5 px-2 py-1 text-left text-xs',
                            selectedModel === model ? 'bg-muted/50' : ''
                          )}
                        >
                          {getModelOptionIcon(model)}
                          <span>{model}</span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
