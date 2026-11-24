'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ProviderIcon } from '@/components/icons/provider-icon'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui'
import { reasoningSchema, supportsReasoning } from '@/lib/mastra/reasoning'
import { cn } from '@/lib/utils'
import { useCopilotModels } from '@/hooks/queries/copilot-models'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'
import { isCopilotBusy } from '@/stores/copilot/store-state'

interface ModelSelectorProps {
  isNearTop: boolean
  panelWidth: number
}

function ModelLabel({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <ProviderIcon provider={label.split('/')[0]} className='h-3 w-3' />
      <span className='truncate'>{label}</span>
    </span>
  )
}

export function ModelSelector({ isNearTop, panelWidth }: ModelSelectorProps) {
  const { models: copy, reasoning: reasoningCopy } = useCopilotMessages()
  const catalog = useCopilotModels()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [choice, setChoice] = useState('auto')
  const [budget, setBudget] = useState('')
  const { selectedModel, setSelectedModel, reasoning, setReasoning, busy } = useCopilotStore(
    useShallow((state) => ({
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
      reasoning: state.reasoning,
      setReasoning: state.setReasoning,
      busy: isCopilotBusy(state),
    }))
  )

  useEffect(() => setOptionsOpen(false), [selectedModel])

  useEffect(() => {
    if (!catalog.data || busy) return
    if (catalog.data.models.some(({ id }) => id === selectedModel)) return
    const firstModel = catalog.data.models[0]?.id ?? null
    if (selectedModel !== firstModel) setSelectedModel(firstModel)
  }, [busy, catalog.data, selectedModel, setSelectedModel])

  const selected = catalog.data?.models.find(({ id }) => id === selectedModel)
  const options = selected?.reasoningOptions
  const budgetOption = options?.find((option) => option.type === 'budget_tokens')
  useEffect(() => {
    if (selected && !busy && reasoning && !supportsReasoning(options, reasoning))
      setReasoning(undefined)
  }, [selected, options, busy, reasoning, setReasoning])
  const selection = reasoningSchema.safeParse(
    choice === 'budget_tokens'
      ? { type: choice, value: budget.trim() ? Number(budget) : undefined }
      : choice === 'true' || choice === 'false'
        ? { type: 'toggle', value: choice === 'true' }
        : { type: 'effort', value: choice }
  ).data
  const valid = choice === 'auto' || (selection && supportsReasoning(options, selection))
  const unavailable = catalog.isPending
    ? copy.loading
    : selectedModel || (catalog.isError && !catalog.data)
      ? copy.loadError
      : copy.unconfigured

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void catalog.refetch()}>
        <DropdownMenuTrigger
          disabled={busy || !catalog.data?.models.length}
          render={
            <Button
              variant='outline'
              size='sm'
              aria-label={selected?.label ?? unavailable}
              title={selected?.label ?? unavailable}
              className='flex h-6 min-w-0 items-center gap-1.5 rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30'
            />
          }
        >
          {selected ? (
            <ModelLabel
              label={selected.label}
              className={cn('max-w-[160px]', panelWidth < 480 && 'max-w-[72px]')}
            />
          ) : (
            <span className='truncate'>{unavailable}</span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
          <div className='max-h-64 min-w-[160px] max-w-[min(360px,90vw)] overflow-y-auto p-1'>
            {catalog.data?.models.map(({ id, label }) => (
              <DropdownMenuItem
                key={id}
                title={label}
                aria-label={label}
                disabled={busy}
                onClick={() => setSelectedModel(id)}
                className={cn(
                  'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                  selectedModel === id && 'bg-muted/40'
                )}
              >
                <ModelLabel label={label} />
                {selectedModel === id && <Check className='h-3 w-3 text-muted-foreground' />}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {!!options?.length && (
        <Popover
          open={optionsOpen}
          onOpenChange={(open) => {
            setOptionsOpen(open)
            if (open) {
              setChoice(
                reasoning?.type === 'budget_tokens'
                  ? 'budget_tokens'
                  : String(reasoning?.value ?? 'auto')
              )
              setBudget(
                String(
                  reasoning?.type === 'budget_tokens' ? reasoning.value : (budgetOption?.min ?? 0)
                )
              )
            }
          }}
        >
          <PopoverTrigger
            disabled={busy}
            render={
              <Button
                variant='outline'
                size='sm'
                aria-label={reasoningCopy.label}
                title={reasoningCopy.label}
                className='h-6 min-w-0 rounded-sm px-2 py-1 font-medium text-xs'
              />
            }
          >
            <span className='max-w-20 truncate'>{reasoningCopy.label}</span>
          </PopoverTrigger>
          <PopoverContent
            align='start'
            side={isNearTop ? 'bottom' : 'top'}
            className='space-y-2 p-3'
          >
            <label className='block space-y-1 text-xs'>
              <span>{reasoningCopy.label}</span>
              <select
                className='w-full rounded border bg-background px-2 py-1'
                disabled={busy}
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value='auto'>{reasoningCopy.providerDefault}</option>
                {options.map((option) =>
                  option.type === 'effort' ? (
                    option.values.map((level) => (
                      <option key={level} value={level}>
                        {reasoningCopy.effort} · {level}
                      </option>
                    ))
                  ) : option.type === 'budget_tokens' ? (
                    <option key={option.type} value={option.type}>
                      {reasoningCopy.budget}
                    </option>
                  ) : (
                    <optgroup key={option.type} label={reasoningCopy.label}>
                      <option value='true'>{reasoningCopy.on}</option>
                      <option value='false'>{reasoningCopy.off}</option>
                    </optgroup>
                  )
                )}
              </select>
            </label>
            {choice === 'budget_tokens' && (
              <Input
                type='number'
                aria-label={reasoningCopy.budget}
                min={budgetOption?.min ?? 0}
                max={budgetOption?.max}
                step={1}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                disabled={busy}
              />
            )}
            <Button
              size='sm'
              disabled={busy || !valid}
              onClick={() => {
                if (busy || !valid) return
                setReasoning(choice === 'auto' ? undefined : selection)
                setOptionsOpen(false)
              }}
            >
              {reasoningCopy.apply}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
