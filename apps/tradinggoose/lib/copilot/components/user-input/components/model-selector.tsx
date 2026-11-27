'use client'

import { useEffect } from 'react'
import { Brain, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useShallow } from 'zustand/react/shallow'
import { ProviderIcon } from '@/components/icons/provider-icon'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { useCopilotModels } from '@/hooks/queries/copilot-models'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore } from '@/stores/copilot/store'
import { isCopilotBusy } from '@/stores/copilot/store-state'
import { SELECTOR_TRIGGER_CLASS } from '../constants'

function SelectorLabel({ label }: { label: string }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5 text-left'>
      <ProviderIcon provider={label.split('/')[0]} className='h-3 w-3' />
      <span className='min-w-0 whitespace-normal [overflow-wrap:anywhere]'>{label}</span>
    </span>
  )
}

export function ModelSelector({ isNearTop }: { isNearTop: boolean }) {
  const { models: copy, reasoning: reasoningCopy } = useCopilotMessages()
  const retry = useTranslations('workspace.widgets.stateMessage')('retry')
  const catalog = useCopilotModels()
  const { selectedModel, setSelectedModel, reasoning, setReasoning, busy } = useCopilotStore(
    useShallow((state) => ({
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
      reasoning: state.reasoning,
      setReasoning: state.setReasoning,
      busy: isCopilotBusy(state),
    }))
  )

  const selected = catalog.data?.models.find(({ id }) => id === selectedModel)
  const option = selected?.reasoningOptions?.[0]
  const savedLevel = reasoning?.value
  const selectedLevel =
    savedLevel && (busy || option?.values.includes(savedLevel)) ? savedLevel : option?.defaultValue
  useEffect(() => {
    if (!catalog.data || catalog.isError || busy) return
    const firstModel = catalog.data.models[0]?.id ?? null
    if (!selected && selectedModel !== firstModel) setSelectedModel(firstModel)
    else if (selected && savedLevel !== selectedLevel)
      setReasoning(selectedLevel && { type: 'effort', value: selectedLevel })
  }, [
    busy,
    catalog.data,
    catalog.isError,
    savedLevel,
    selected,
    selectedLevel,
    selectedModel,
    setReasoning,
    setSelectedModel,
  ])

  const unavailable = catalog.isPending
    ? copy.loading
    : selectedModel || catalog.isError
      ? copy.loadError
      : copy.unconfigured

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void catalog.refetch()}>
        <DropdownMenuTrigger
          disabled={busy || (!catalog.isError && !catalog.data?.models.length)}
          render={
            <Button
              variant='outline'
              size='sm'
              aria-label={selected?.label ?? unavailable}
              title={selected?.label ?? unavailable}
              className={SELECTOR_TRIGGER_CLASS}
            />
          }
        >
          {selected ? <SelectorLabel label={selected.label} /> : unavailable}
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
          <div className='max-h-64 min-w-[160px] max-w-[min(360px,90vw)] overflow-y-auto p-1'>
            {catalog.isError && (
              <>
                <p role='alert' className='px-2 py-1 text-destructive text-xs'>
                  {copy.loadError} {catalog.error?.message}
                </p>
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={catalog.isFetching}
                  onClick={() => void catalog.refetch()}
                >
                  {retry}
                </DropdownMenuItem>
              </>
            )}
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
                <SelectorLabel label={label} />
                {selectedModel === id && <Check className='h-3 w-3 text-muted-foreground' />}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {option && selectedLevel && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            render={
              <Button
                variant='outline'
                size='sm'
                aria-label={`${reasoningCopy.label} · ${selectedLevel}`}
                className={SELECTOR_TRIGGER_CLASS}
              />
            }
          >
            <Brain aria-hidden='true' className='h-3 w-3 text-muted-foreground' />
            <span>{selectedLevel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'}>
            {option.values.map((value) => (
              <DropdownMenuItem
                key={value}
                disabled={busy}
                aria-current={selectedLevel === value}
                onClick={() => setReasoning({ type: 'effort', value })}
                className={cn('text-xs', selectedLevel === value && 'bg-muted/40')}
              >
                {value}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
