'use client'

import { Brain, BrainCircuit, Zap } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TooltipProvider,
} from '@/components/ui'
import {
  COPILOT_RUNTIME_MODEL_OPTIONS,
  type CopilotRuntimeModel,
  DEFAULT_COPILOT_RUNTIME_MODEL,
} from '@/lib/copilot/runtime-models'
import { cn } from '@/lib/utils'
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
  const { agentPrefetch, selectedModel, setAgentPrefetch, setSelectedModel } = useCopilotStore()

  const model = COPILOT_RUNTIME_MODEL_OPTIONS.find((option) => option.value === selectedModel)
  const collapsedModeLabel = model ? model.label : DEFAULT_COPILOT_RUNTIME_MODEL

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='flex h-6 bg-background hover:bg-muted/30 items-center gap-1.5 rounded-sm border px-2 py-1 font-medium text-xs focus-visible:ring-0 focus-visible:ring-offset-0'
          title='Choose model'
        >
          {getModelOptionIcon(selectedModel)}
          <span className={cn(panelWidth < 360 ? 'max-w-[72px] truncate' : '')}>
            {collapsedModeLabel}
            {agentPrefetch && !FAST_MODELS.includes(selectedModel) && (
              <span className='ml-1 font-semibold'>Lite</span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isNearTop ? 'bottom' : 'top'} className='max-h-[400px] p-0'>
        <TooltipProvider delayDuration={100} skipDelayDuration={0}>
          <div className='w-[220px]'>
            <div className='max-h-[280px] overflow-y-auto p-2'>
              <div>
                <div className='mb-1'>
                  <span className='font-medium text-xs'>Model</span>
                </div>
                <div className='space-y-2'>
                  <div>
                    <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                      Anthropic
                    </div>
                    <div className='space-y-0.5'>
                      {COPILOT_RUNTIME_MODEL_OPTIONS.filter((option) =>
                        ANTHROPIC_MODELS.includes(option.value)
                      ).map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onSelect={() => {
                            setSelectedModel(option.value)
                            if (FAST_MODELS.includes(option.value) && agentPrefetch) {
                              setAgentPrefetch(false)
                            }
                          }}
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

                  <div>
                    <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                      OpenAI
                    </div>
                    <div className='space-y-0.5'>
                      {COPILOT_RUNTIME_MODEL_OPTIONS.filter((option) =>
                        OPENAI_MODELS.includes(option.value)
                      ).map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onSelect={() => {
                            setSelectedModel(option.value)
                            if (FAST_MODELS.includes(option.value) && agentPrefetch) {
                              setAgentPrefetch(false)
                            }
                          }}
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
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
