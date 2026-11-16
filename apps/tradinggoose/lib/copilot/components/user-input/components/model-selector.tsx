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
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from '@/components/ui'
import { parseProviderOptions } from '@/lib/mastra/options'
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
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)
  const { selectedModel, setSelectedModel, providerOptions, setProviderOptions, busy } =
    useCopilotStore(
      useShallow((state) => ({
        selectedModel: state.selectedModel,
        setSelectedModel: state.setSelectedModel,
        providerOptions: state.providerOptions,
        setProviderOptions: state.setProviderOptions,
        busy: isCopilotBusy(state),
      }))
    )

  useEffect(() => setOptionsOpen(false), [selectedModel])

  useEffect(() => {
    if (!catalog.data || busy) return
    if (catalog.data.models.some(({ id }) => id === selectedModel)) return
    const firstModel = catalog.data.models[0]?.id ?? null
    if (selectedModel !== firstModel) void setSelectedModel(firstModel)
  }, [busy, catalog.data, selectedModel, setSelectedModel])

  const selected = catalog.data?.models.find(({ id }) => id === selectedModel)
  const reasoningUnsupported =
    selected?.reasoning === false || selected?.reasoningOptions?.length === 0
  const reasoningDisabled = busy || !selected || reasoningUnsupported
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
                onClick={() => void setSelectedModel(id)}
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
      <Popover
        open={optionsOpen}
        onOpenChange={(open) => {
          setOptionsOpen(open)
          if (open) {
            setDraft(JSON.stringify(providerOptions ?? {}, null, 2))
            setError(false)
          }
        }}
      >
        <PopoverTrigger
          disabled={reasoningDisabled}
          render={
            <Button
              variant='outline'
              size='sm'
              aria-label={reasoningCopy.label}
              title={reasoningUnsupported ? reasoningCopy.unsupported : reasoningCopy.label}
              className='h-6 min-w-0 rounded-sm px-2 py-1 font-medium text-xs'
            />
          }
        >
          <span className='max-w-20 truncate'>{reasoningCopy.label}</span>
        </PopoverTrigger>
        <PopoverContent align='start' side={isNearTop ? 'bottom' : 'top'} className='space-y-2 p-3'>
          <p className='font-medium text-sm'>{reasoningCopy.label}</p>
          <p className='text-muted-foreground text-xs'>{reasoningCopy.description}</p>
          {selected?.reasoningOptions?.map((option, index) => (
            <p key={index} className='text-muted-foreground text-xs'>
              {option.type === 'effort'
                ? `${reasoningCopy.effort}: ${option.values.join(', ')}`
                : option.type === 'budget_tokens'
                  ? [
                      reasoningCopy.budget,
                      option.min === undefined ? '' : `${reasoningCopy.minimum} ${option.min}`,
                      option.max === undefined ? '' : `${reasoningCopy.maximum} ${option.max}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : reasoningCopy.toggle}
            </p>
          ))}
          <Textarea
            aria-label={reasoningCopy.providerOptions}
            value={draft}
            disabled={reasoningDisabled}
            spellCheck={false}
            className='min-h-32 font-mono text-xs'
            onChange={(event) => {
              setDraft(event.target.value)
              setError(false)
            }}
          />
          {error && (
            <p role='alert' className='text-destructive text-xs'>
              {reasoningCopy.invalid}
            </p>
          )}
          <Button
            size='sm'
            disabled={reasoningDisabled}
            onClick={() => {
              if (reasoningDisabled) return
              try {
                const options = parseProviderOptions(draft)
                setProviderOptions(Object.keys(options).length ? options : undefined)
                setOptionsOpen(false)
              } catch {
                setError(true)
              }
            }}
          >
            {reasoningCopy.apply}
          </Button>
        </PopoverContent>
      </Popover>
    </>
  )
}
