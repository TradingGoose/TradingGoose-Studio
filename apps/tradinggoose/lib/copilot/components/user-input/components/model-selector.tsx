'use client'

import { useEffect } from 'react'
import { Brain, Check, type LucideIcon } from 'lucide-react'
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

function SelectorLabel({ label, icon: Icon }: { label: string; icon?: LucideIcon }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5 text-left'>
      {Icon ? (
        <Icon aria-hidden='true' className='h-3 w-3 shrink-0' />
      ) : (
        <ProviderIcon provider={label.split('/')[0]} className='h-3 w-3' />
      )}
      <span className='min-w-0 whitespace-normal [overflow-wrap:anywhere]'>{label}</span>
    </span>
  )
}

export function ModelSelector({ isNearTop }: { isNearTop: boolean }) {
  const { models: copy, reasoning: reasoningCopy } = useCopilotMessages()
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
  useEffect(() => {
    if (!catalog.data || busy || selected) return
    const firstModel = catalog.data.models[0]?.id ?? null
    if (selectedModel !== firstModel) setSelectedModel(firstModel)
  }, [busy, catalog.data, selected, selectedModel, setSelectedModel])

  const levels = selected?.reasoningOptions?.[0]?.values
  const levelLabel = reasoning?.value ?? reasoningCopy.selectLevel
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
              className='h-auto min-h-6 max-w-full whitespace-normal rounded-sm px-2 py-1 font-medium text-xs'
            />
          }
        >
          {selected ? <SelectorLabel label={selected.label} /> : unavailable}
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
                <SelectorLabel label={label} />
                {selectedModel === id && <Check className='h-3 w-3 text-muted-foreground' />}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {!!levels?.length && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            render={
              <Button
                variant='outline'
                size='sm'
                aria-label={`${reasoningCopy.label} · ${levelLabel}`}
                className='h-auto min-h-6 max-w-full whitespace-normal rounded-sm px-2 py-1 font-medium text-xs'
              />
            }
          >
            <SelectorLabel label={levelLabel} icon={Brain} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'}>
            {levels.map((value) => (
              <DropdownMenuItem
                key={value}
                disabled={busy}
                aria-current={reasoning?.value === value}
                onClick={() => setReasoning({ type: 'effort', value })}
                className={cn('text-xs', reasoning?.value === value && 'bg-muted/40')}
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
