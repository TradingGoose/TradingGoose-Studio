'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useMessages } from 'next-intl'
import { ProviderIcon } from '@/components/icons/provider-icon'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { SidebarDropdownMenuContent } from '@/components/ui/sidebar-dropdown-menu'
import {
  type CopilotSettings,
  CopilotSettingsSchema,
  getCopilotModelId,
} from '@/lib/copilot/settings'
import { formatTemplate } from '@/i18n/utils'
import { getModelGroups, getModelOptions, useModelRegistry } from '@/stores/model-registry'

function CopilotModelPicker({
  id,
  row,
  options,
  groups,
  label,
  placeholder,
  emptyContent,
  disabled,
  onChange,
}: {
  id: string
  row: CopilotSettings['models'][number]
  options: ReturnType<typeof getModelOptions>
  groups: ReturnType<typeof getModelGroups>
  label: string
  placeholder: string
  emptyContent: string
  disabled: boolean
  onChange: (row: CopilotSettings['models'][number]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState(row.provider)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const currentId = row.model.trim() ? getCopilotModelId(row) : ''
  const query = search.trim()
  const normalizedQuery = query.toLowerCase()
  const filtered = options.filter((option) =>
    option.searchLabel.toLowerCase().includes(normalizedQuery)
  )
  const enteredId = query || currentId
  // Registered provider IDs and model IDs can both contain slashes.
  const enteredGroup = groups
    .filter((group) => enteredId.startsWith(`${group.id}/`))
    .sort((a, b) => b.id.length - a.id.length)[0]
  if (enteredGroup && !options.some((option) => option.id === enteredId)) {
    const parsed = CopilotSettingsSchema.shape.models.element.safeParse({
      provider: enteredGroup.id,
      model: enteredId.slice(enteredGroup.id.length + 1),
    })
    if (parsed.success) {
      filtered.push({
        id: getCopilotModelId(parsed.data),
        label: getCopilotModelId(parsed.data),
        group: enteredGroup.id,
        searchLabel: enteredId,
        icon: enteredGroup.icon,
      })
    }
  }
  const groupIds = new Set(filtered.map((option) => option.group))
  const visibleGroups = groups.filter((group) => groupIds.has(group.id))
  const resolvedGroup = visibleGroups.some((group) => group.id === activeGroup)
    ? activeGroup
    : enteredGroup && groupIds.has(enteredGroup.id)
      ? enteredGroup.id
      : (visibleGroups[0]?.id ?? '')
  const activeItems = filtered.filter((option) => option.group === resolvedGroup)

  function select(id: string, provider: string) {
    onChange({ provider, model: id.slice(provider.length + 1) })
    setOpen(false)
  }

  useEffect(() => {
    popupRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlightedId])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSearch('')
          setActiveGroup(row.provider)
          setHighlightedId(null)
        }
      }}
    >
      <PopoverTrigger
        id={id}
        render={
          <Button
            type='button'
            variant='outline'
            disabled={disabled}
            aria-label={label}
            title={currentId || placeholder}
            className='w-full min-w-0 justify-start'
          >
            {currentId ? <ProviderIcon provider={row.provider} /> : null}
            <span className='min-w-0 flex-1 truncate text-left'>{currentId || placeholder}</span>
            <ChevronDown aria-hidden='true' className='size-4 shrink-0 opacity-50' />
          </Button>
        }
      />
      <PopoverContent
        ref={popupRef}
        align='start'
        initialFocus={inputRef}
        aria-label={label}
        className='w-[var(--anchor-width)] min-w-80 max-w-[calc(100vw-2rem)] p-0'
      >
        <div className='border-b p-2'>
          <Input
            ref={inputRef}
            aria-label={label}
            placeholder={placeholder}
            value={search}
            autoComplete='off'
            spellCheck={false}
            onChange={(event) => {
              setSearch(event.target.value)
              setActiveGroup('')
              setHighlightedId(null)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                event.stopPropagation()
                if (!activeItems.length) return
                const index = activeItems.findIndex((item) => item.id === highlightedId)
                const next =
                  event.key === 'ArrowDown'
                    ? index + 1
                    : index <= 0
                      ? activeItems.length - 1
                      : index - 1
                setHighlightedId(activeItems[next % activeItems.length]?.id ?? null)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                const item =
                  activeItems.find((item) => item.id === highlightedId) ??
                  activeItems.find((item) => item.id === enteredId) ??
                  activeItems[0]
                if (item) select(item.id, item.group)
              }
            }}
          />
        </div>
        <SidebarDropdownMenuContent
          groups={visibleGroups}
          items={filtered.map((option) => {
            const Icon = option.icon
            return {
              id: option.id,
              label: option.label,
              groupId: option.group,
              selected: option.id === currentId,
              icon: <Icon className='h-3 w-3' />,
            }
          })}
          activeGroupId={resolvedGroup}
          highlightedItemId={highlightedId}
          onActiveGroupChange={(group) => {
            setActiveGroup(group)
            setHighlightedId(null)
          }}
          onSelectItem={(item) => select(item.id, item.groupId)}
          onHighlightItem={(item) => setHighlightedId(item.id)}
          emptyContent={emptyContent}
        />
      </PopoverContent>
    </Popover>
  )
}

export function CopilotSettingsFields({
  value,
  onChange,
}: {
  value: CopilotSettings
  onChange: (value: CopilotSettings) => void
}) {
  const messages = useMessages()
  const copy = messages.admin.systemSettings.copilot
  const registryCopy = messages.workspace.widgets.workflowLabels
  const { providers, isLoading, error, load } = useModelRegistry()
  const options = useMemo(getModelOptions, [providers])
  const groups = useMemo(getModelGroups, [providers])
  useEffect(() => {
    void load()
  }, [load])
  const isValid = CopilotSettingsSchema.safeParse(value).success

  function updateRow(index: number, update: CopilotSettings['models'][number]) {
    onChange({
      models: value.models.map((row, position) => (position === index ? update : row)),
    })
  }

  function removeRow(index: number) {
    onChange({ models: value.models.filter((_, position) => position !== index) })
  }

  return (
    <section className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
      <div className='space-y-1'>
        <h3 className='font-medium text-sm'>{copy.title}</h3>
        <p className='text-muted-foreground text-xs leading-relaxed'>{copy.description}</p>
      </div>

      {isLoading ? (
        <p role='status' className='text-muted-foreground text-sm'>
          {registryCopy.loadingModels}
        </p>
      ) : null}
      {error || (!isLoading && !providers.length) ? (
        <div role='alert' className='space-y-2 text-destructive text-sm'>
          <p>{registryCopy.modelRegistryUnavailable}</p>
          <Button type='button' variant='outline' disabled={isLoading} onClick={() => void load()}>
            {registryCopy.retryModels}
          </Button>
        </div>
      ) : null}

      {value.models.length ? (
        <div className='space-y-3'>
          {value.models.map((row, index) => (
            <div key={index} className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3'>
              <CopilotModelPicker
                id={`copilot-model-${index}`}
                row={row}
                options={options}
                groups={groups}
                label={copy.model}
                placeholder={copy.modelPlaceholder}
                emptyContent={registryCopy.noMatchingOptionsFound}
                disabled={isLoading || !providers.length}
                onChange={(selected) => updateRow(index, selected)}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => removeRow(index)}
                aria-label={formatTemplate(copy.removeModel, { number: String(index + 1) })}
              >
                <Trash2 aria-hidden='true' className='size-4' />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className='rounded-md border border-dashed px-3 py-4 text-muted-foreground text-sm'>
          {copy.empty}
        </p>
      )}

      {!isValid ? (
        <p id='copilot-models-validation' role='alert' className='text-destructive text-sm'>
          {copy.invalidModels}
        </p>
      ) : null}

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          disabled={isLoading || !providers.length}
          onClick={() => {
            const row = { provider: providers[0].id, model: '' }
            onChange({ models: [...value.models, row] })
          }}
        >
          <Plus aria-hidden='true' className='mr-2 size-4' />
          {copy.addModel}
        </Button>
      </div>
    </section>
  )
}
