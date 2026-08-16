'use client'

import { Brain, BrainCircuit, Zap } from 'lucide-react'
import { shallow } from 'zustand/shallow'
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
import {
  COPILOT_RUNTIME_MODEL_OPTIONS,
  type CopilotRuntimeModel,
  DEFAULT_COPILOT_RUNTIME_MODEL,
} from '@/lib/copilot/runtime-models'
import { cn } from '@/lib/utils'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'
import {
  ANTHROPIC_MODELS,
  BRAIN_CIRCUIT_MODELS,
  BRAIN_MODELS,
  FAST_MODELS,
  OPENAI_MODELS,
} from '../constants'

interface ModelSelectorProps {
  isNearTop: boolean
  panelWidth: number
}

const MODEL_PROVIDER_GROUPS = [
  { provider: 'anthropic', models: ANTHROPIC_MODELS },
  { provider: 'openai', models: OPENAI_MODELS },
] as const

const DEFAULT_MODEL_LABEL =
  COPILOT_RUNTIME_MODEL_OPTIONS.find((option) => option.value === DEFAULT_COPILOT_RUNTIME_MODEL)
    ?.label ?? DEFAULT_COPILOT_RUNTIME_MODEL

const getModelOptionIcon = (modelValue: CopilotRuntimeModel) => {
  if (BRAIN_CIRCUIT_MODELS.includes(modelValue)) {
    return <BrainCircuit className='h-3 w-3 text-muted-foreground' />
  }

  if (BRAIN_MODELS.includes(modelValue)) {
    return <Brain className='h-3 w-3 text-muted-foreground' />
  }

  if (FAST_MODELS.includes(modelValue)) {
    return <Zap className='h-3 w-3 text-muted-foreground' />
  }

  return <div className='h-3 w-3' />
}

export function ModelSelector({ isNearTop, panelWidth }: ModelSelectorProps) {
  const modelCopy = useCopilotMessages().model
  const { agentPrefetch, selectedModel, setAgentPrefetch, setSelectedModel } = useCopilotStore(
    (state) => ({
      agentPrefetch: state.agentPrefetch,
      selectedModel: state.selectedModel,
      setAgentPrefetch: state.setAgentPrefetch,
      setSelectedModel: state.setSelectedModel,
    }),
    shallow
  )

  const model = COPILOT_RUNTIME_MODEL_OPTIONS.find((option) => option.value === selectedModel)
  const collapsedModelLabel = model?.label ?? DEFAULT_MODEL_LABEL
  const handleModelSelect = (modelValue: CopilotRuntimeModel) => {
    void setSelectedModel(modelValue)
    if (FAST_MODELS.includes(modelValue) && agentPrefetch) setAgentPrefetch(false)
  }

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
                  {collapsedModelLabel}
                  {agentPrefetch && !FAST_MODELS.includes(selectedModel) && (
                    <span className='ml-1 font-semibold'>{modelCopy.lite}</span>
                  )}
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
                      {COPILOT_RUNTIME_MODEL_OPTIONS.filter((option) =>
                        models.includes(option.value)
                      ).map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => handleModelSelect(option.value)}
                          className={cn(
                            'flex h-7 items-center gap-1.5 px-2 py-1 text-left text-xs',
                            selectedModel === option.value ? 'bg-muted/50' : ''
                          )}
                        >
                          {getModelOptionIcon(option.value)}
                          <span>{option.label}</span>
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
