'use client'

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, ChevronDown, List, Pencil, Trash2 } from 'lucide-react'
import { useMessages } from 'next-intl'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { type ListingOption, toListingValue } from '@/lib/listing/identity'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { exportWatchlistAsJson, WATCHLIST_EXPORT_SOURCE } from '@/lib/watchlists/import-export'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { useSelectedWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import { DataChartListingSelector } from '@/widgets/widgets/data_chart/components/listing-control'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/contract'

type WatchlistHeaderControlsSlotProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
  canEditWidgetParams?: boolean
  canMutateWatchlist?: boolean
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

const resolveWatchlistParams = (widget?: WidgetInstance | null): WatchlistWidgetParams | null => {
  return widget?.params && typeof widget.params === 'object'
    ? (widget.params as WatchlistWidgetParams)
    : null
}

const normalizeSelectedWatchlistId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const resolveSelectedWatchlistId = ({ params }: { params: WatchlistWidgetParams | null }) => {
  return normalizeSelectedWatchlistId(params?.watchlistId)
}

const buildWatchlistHeaderListingSelectorId = (panelId: string | undefined, widgetKey: string) =>
  `watchlist-header-listing-${panelId ?? 'panel'}-${widgetKey}`

type WatchlistListOption = {
  id: string
  name: string
  watchlistId: string
}

const resolveWatchlistListColor = (option: Pick<WatchlistListOption, 'watchlistId'>) =>
  getEntityIconColor(option.watchlistId)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const resolveNextSectionName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined,
  baseName = 'Section'
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'section') continue

    const match = item.label.trim().match(new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i'))
    if (!match) continue

    const value = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(value) && value > 0) {
      usedNumbers.add(value)
    }
  }

  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1
  }

  return `${baseName} ${nextNumber}`
}

export const resolveNextWatchlistName = (
  watchlists: Array<{ entityName?: string | null }>,
  baseName = 'Watchlist'
) => {
  const usedNumbers = new Set<number>()
  let hasBaseName = false

  for (const watchlist of watchlists) {
    const name = watchlist.entityName?.trim()
    if (!name) continue
    if (name.toLowerCase() === baseName.toLowerCase()) {
      hasBaseName = true
      continue
    }

    const match = name.match(new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i'))
    if (!match) continue

    const value = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(value) && value > 0) {
      usedNumbers.add(value)
    }
  }

  if (!hasBaseName) return baseName

  let nextNumber = 2
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1
  }

  return `${baseName} ${nextNumber}`
}

export const WatchlistHeaderLeftControls = ({
  workspaceId,
  panelId,
  widget,
  canEditWidgetParams,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const actions = useWidgetConfigRuntimeActions()
  const patchWidgetParams = (nextParams: Record<string, unknown>) => {
    if (!canEditWidgetParams) return
    actions.patchWidgetParams(nextParams)
  }

  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return
    patchWidgetParams({ provider: nextProvider })
  }

  const handleSaveProviderSettings = ({
    providerParams,
    auth,
  }: {
    providerParams?: Record<string, unknown>
    auth?: Record<string, unknown>
  }) => {
    patchWidgetParams({
      providerParams,
      auth: auth as WatchlistWidgetParams['auth'],
      runtime: {
        refreshAt: Date.now(),
      },
    })
  }

  return (
    <MarketProviderControls
      className='min-w-0'
      value={providerId}
      options={providerOptions}
      onChange={handleProviderChange}
      disabled={!workspaceId || !canEditWidgetParams}
      providerParams={params?.providerParams}
      authParams={params?.auth}
      workspaceId={workspaceId}
      onSettingsSave={handleSaveProviderSettings}
    />
  )
}

export const WatchlistHeaderCenterControls = ({
  workspaceId,
  panelId,
  widget,
  canMutateWatchlist,
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist.header
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const requestedWatchlistId = resolveSelectedWatchlistId({
    params,
  })
  const selectedDocument = useSelectedWatchlistYjsDocument({
    workspaceId,
    watchlistId: requestedWatchlistId,
    accessMode: canMutateWatchlist ? 'write' : 'read',
  })
  const selectedWatchlist = selectedDocument.record
  const selectorInstanceId = useMemo(
    () => buildWatchlistHeaderListingSelectorId(panelId, widgetKey),
    [panelId, widgetKey]
  )
  const ensureSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const selectorInstance = useListingSelectorStore((state) => state.instances[selectorInstanceId])
  const [isAddingListing, setIsAddingListing] = useState(false)
  const pendingListing = selectorInstance?.selectedListingValue ?? null
  const selectorProviderId = workspaceId && selectedWatchlist ? providerId : undefined

  const clearPendingListing = useCallback(
    (nextProviderId = providerId) => {
      updateSelectorInstance(selectorInstanceId, {
        providerId: nextProviderId || undefined,
        query: '',
        results: [],
        isLoading: false,
        error: undefined,
        selectedListingValue: null,
        selectedListing: null,
      })
    },
    [providerId, selectorInstanceId, updateSelectorInstance]
  )

  useEffect(() => {
    ensureSelectorInstance(selectorInstanceId, { providerId: providerId || undefined })
  }, [ensureSelectorInstance, providerId, selectorInstanceId])

  const previousProviderIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const previousProviderId = previousProviderIdRef.current
    const normalizedProviderId = providerId || undefined
    if (previousProviderId !== undefined && previousProviderId !== normalizedProviderId) {
      clearPendingListing(normalizedProviderId)
    } else {
      updateSelectorInstance(selectorInstanceId, { providerId: normalizedProviderId })
    }
    previousProviderIdRef.current = normalizedProviderId
  }, [clearPendingListing, providerId, selectorInstanceId, updateSelectorInstance])

  const previousWatchlistIdRef = useRef<string | null>(null)
  useEffect(() => {
    const nextWatchlistId = selectedWatchlist?.id ?? null
    if (previousWatchlistIdRef.current !== nextWatchlistId) {
      clearPendingListing()
    }
    previousWatchlistIdRef.current = nextWatchlistId
  }, [clearPendingListing, selectedWatchlist?.id])

  const handleListingChange = (listing: ListingOption | null) => {
    updateSelectorInstance(selectorInstanceId, {
      selectedListingValue: toListingValue(listing),
      selectedListing: listing,
    })
  }

  const handleAddListing = async () => {
    if (
      !canMutateWatchlist ||
      !workspaceId ||
      !selectedWatchlist ||
      !pendingListing ||
      isAddingListing
    ) {
      return
    }

    try {
      setIsAddingListing(true)
      const item = {
        id: crypto.randomUUID(),
        type: 'listing' as const,
        parentId: null,
        listing: pendingListing,
      }
      selectedDocument.setItems([...selectedDocument.items, item])
      await selectedDocument.save()
      clearPendingListing()
    } catch {
      // Save errors leave the selector state intact so the user can retry.
    } finally {
      setIsAddingListing(false)
    }
  }

  const addListingDisabled =
    !canMutateWatchlist ||
    !workspaceId ||
    !providerId ||
    !selectedWatchlist ||
    !pendingListing ||
    isAddingListing

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <DataChartListingSelector
        instanceId={selectorInstanceId}
        providerId={selectorProviderId}
        onListingChange={handleListingChange}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={() => {
                void handleAddListing()
              }}
              disabled={addListingDisabled}
            >
              <Check className='h-3.5 w-3.5' />
              <span className='sr-only'>{copy.addListingAriaLabel}</span>
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{copy.addListingTooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export const WatchlistHeaderRightControls = ({
  workspaceId,
  panelId,
  widget,
  canEditWidgetParams,
  canMutateWatchlist,
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist
  const [listDropdownOpen, setListDropdownOpen] = useState(false)
  const [listActionsOpen, setListActionsOpen] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [renamingListValue, setRenamingListValue] = useState('')
  const [listToDelete, setListToDelete] = useState<WatchlistListOption | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const renameListInputRef = useRef<HTMLInputElement | null>(null)

  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const actions = useWidgetConfigRuntimeActions()
  const patchLinkedParams =
    (widget?.pairColor ?? 'gray') === 'gray'
      ? actions.patchWidgetParams
      : actions.patchWidgetColorPair
  const requestedWatchlistId = resolveSelectedWatchlistId({
    params,
  })
  const selectedDocument = useSelectedWatchlistYjsDocument({
    workspaceId,
    watchlistId: requestedWatchlistId,
    accessMode: canMutateWatchlist ? 'write' : 'read',
  })
  const selectedWatchlist = selectedDocument.record
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const listOptions: WatchlistListOption[] = useMemo(() => {
    return selectedDocument.members.map((member) => ({
      id: member.entityId,
      name: member.entityName || 'Watchlist',
      watchlistId: member.entityId,
    }))
  }, [selectedDocument.members])
  const selectedOptionId = selectedDocument.selectedWatchlistId
  const selectedOption = listOptions.find((option) => option.id === selectedOptionId) ?? null
  const selectedOptionColor = selectedOption ? resolveWatchlistListColor(selectedOption) : null

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canManageContainers = canMutateWatchlist && hasSelectedWatchlist
  const isMutating = Boolean(pendingAction)

  const handleSelectList = (watchlistId: string) => {
    if (!canEditWidgetParams) return
    patchLinkedParams({ watchlistId })
  }

  const selectListOption = (option: WatchlistListOption) => {
    cancelListRename()
    handleSelectList(option.watchlistId)
    setListDropdownOpen(false)
  }

  const cancelListRename = () => {
    setEditingListId(null)
    setRenamingListValue('')
  }

  const handleListDropdownOpenChange = (open: boolean) => {
    setListDropdownOpen(open)
    if (!open) cancelListRename()
  }

  const startRenameList = (option: WatchlistListOption) => {
    if (option.watchlistId !== selectedWatchlist?.id || isMutating) return
    setEditingListId(option.watchlistId)
    setRenamingListValue(option.name)
  }

  const handleCreateList = async () => {
    if (!canMutateWatchlist || !workspaceId || pendingAction) {
      return
    }

    try {
      setPendingAction('create-list')
      const response = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: resolveNextWatchlistName(
            selectedDocument.members,
            copy.header.defaultWatchlistPrefix
          ),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.watchlist?.id) {
        throw new Error(payload?.error || 'Failed to create watchlist')
      }
      handleSelectList(payload.watchlist.id)
    } catch {
      // Creation errors keep the current watchlist selection intact.
    } finally {
      setPendingAction(null)
    }
  }

  const handleConfirmRemoveList = async () => {
    const watchlistId = listToDelete?.watchlistId
    if (!canMutateWatchlist || !workspaceId || !watchlistId || pendingAction) return

    try {
      setPendingAction('delete-list')
      const nextOption = listOptions.find((option) => option.watchlistId !== watchlistId) ?? null
      const response = await fetch(
        `/api/watchlists/${encodeURIComponent(watchlistId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to delete watchlist')
      }
      setListToDelete(null)
      if (selectedWatchlist?.id === watchlistId && nextOption) {
        handleSelectList(nextOption.watchlistId)
      }
    } catch {
      // Keep the current list in place so the user can retry.
    } finally {
      setPendingAction(null)
    }
  }

  const commitListRename = async () => {
    if (
      !canMutateWatchlist ||
      !workspaceId ||
      !editingListId ||
      !selectedWatchlist ||
      editingListId !== selectedWatchlist.id
    ) {
      cancelListRename()
      return
    }

    const nextName = renamingListValue.trim()
    if (!nextName || nextName === selectedWatchlist.name) {
      cancelListRename()
      return
    }

    try {
      setPendingAction('rename-list')
      await renameSavedEntityAction({
        entityKind: 'watchlist',
        entityId: selectedWatchlist.id,
        workspaceId,
        name: nextName,
      })
      cancelListRename()
    } catch {
      // Keep edit mode active so the user can retry.
    } finally {
      setPendingAction(null)
    }
  }

  const handleListRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitListRename()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelListRename()
    }
  }

  useEffect(() => {
    if (!editingListId) return
    renameListInputRef.current?.focus()
    renameListInputRef.current?.select()
  }, [editingListId])

  useEffect(() => {
    if (!editingListId) return
    if (selectedWatchlist?.id === editingListId) return
    cancelListRename()
  }, [editingListId, selectedWatchlist?.id])

  const handleImportClick = () => {
    if (canMutateWatchlist) fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!canMutateWatchlist || !file || !workspaceId || !selectedWatchlist || pendingAction) {
      event.target.value = ''
      return
    }

    try {
      setPendingAction('import')
      const content = await file.text()
      const parsed = JSON.parse(content) as unknown
      const response = await fetch(
        `/api/watchlists/${encodeURIComponent(selectedWatchlist.id)}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, file: parsed }),
        }
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to import watchlist')
      }
    } catch {
      // Invalid files or save errors leave the existing watchlist unchanged.
    } finally {
      setPendingAction(null)
      event.target.value = ''
    }
  }

  const handleExport = async () => {
    if (!workspaceId || !selectedWatchlist || pendingAction) return
    try {
      setPendingAction('export')
      const content = exportWatchlistAsJson({
        fields: {
          name: selectedDocument.name,
          settings: selectedDocument.settings,
          items: selectedDocument.items,
        },
        exportedFrom: WATCHLIST_EXPORT_SOURCE,
      })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeName =
        selectedWatchlist.name
          .trim()
          .replace(/[^a-z0-9._-]+/gi, '-')
          .replace(/^-+|-+$/g, '') || selectedWatchlist.id

      const blob = new Blob([content], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName}-${timestamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      // Export errors are non-destructive.
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateSection = async () => {
    if (!canMutateWatchlist || !workspaceId || !selectedWatchlist || pendingAction) {
      return
    }

    try {
      setPendingAction('section')
      selectedDocument.setItems([
        ...selectedDocument.items,
        {
          id: crypto.randomUUID(),
          type: 'section',
          parentId: null,
          label: resolveNextSectionName(selectedWatchlist, copy.header.defaultSectionPrefix),
        },
      ])
      await selectedDocument.save()
    } catch {
      // Save errors leave the existing containers unchanged.
    } finally {
      setPendingAction(null)
    }
  }

  const handleRefreshData = () => {
    if (!canEditWidgetParams || !providerId) return
    actions.patchWidgetParams({
      runtime: {
        refreshAt: Date.now(),
      },
    })
  }

  return (
    <>
      <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
        <div className='min-w-0'>
          <DropdownMenu
            modal={false}
            open={listDropdownOpen}
            onOpenChange={handleListDropdownOpenChange}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex'>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      disabled={!workspaceId || !selectedWatchlist || !canEditWidgetParams}
                      className={widgetHeaderControlClassName(
                        'group flex min-w-[240px] items-center justify-between gap-1'
                      )}
                      aria-haspopup='listbox'
                      aria-label={copy.header.explorer}
                    >
                      {selectedOptionColor ? (
                        <span
                          className='h-5 w-5 rounded-xs p-0.5'
                          style={{ backgroundColor: `${selectedOptionColor}20` }}
                          aria-hidden='true'
                        >
                          <List
                            className='h-4 w-4'
                            aria-hidden='true'
                            style={{ color: selectedOptionColor }}
                          />
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-left font-medium text-sm',
                          selectedOption ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {selectedOption?.name ?? 'Watchlist'}
                      </span>
                      <ChevronDown
                        className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                        aria-hidden='true'
                      />
                    </button>
                  </DropdownMenuTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side='top'>
                {!workspaceId || !selectedWatchlist
                  ? copy.header.selectWorkspace
                  : copy.header.explorer}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align='end'
              sideOffset={6}
              className={cn(
                widgetHeaderMenuContentClassName,
                'max-h-[20rem] w-[240px] overflow-y-auto p-2 shadow-lg'
              )}
              onWheel={(event) => event.stopPropagation()}
            >
              {listOptions.map((option) => {
                const isSelected = option.id === selectedOptionId
                const isEditing = option.watchlistId === editingListId
                const optionColor = resolveWatchlistListColor(option)

                return (
                  <div
                    key={option.id}
                    className={cn(
                      'group/list flex h-8 cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors',
                      isSelected ? 'bg-secondary/60' : 'hover:bg-secondary/30'
                    )}
                  >
                    {isEditing ? (
                      <>
                        <span
                          className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
                          style={{ backgroundColor: `${optionColor}20` }}
                          aria-hidden='true'
                        >
                          <List
                            className='h-4 w-4'
                            aria-hidden='true'
                            style={{ color: optionColor }}
                          />
                        </span>
                        <input
                          ref={renameListInputRef}
                          value={renamingListValue}
                          onChange={(event) => setRenamingListValue(event.target.value)}
                          onBlur={() => {
                            void commitListRename()
                          }}
                          onKeyDown={handleListRenameKeyDown}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                          className={cn(
                            'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                            isSelected
                              ? 'text-foreground'
                              : 'text-muted-foreground group-hover/list:text-foreground'
                          )}
                          maxLength={100}
                          disabled={!canMutateWatchlist || pendingAction === 'rename-list'}
                          autoComplete='off'
                          autoCorrect='off'
                          autoCapitalize='off'
                          spellCheck='false'
                          aria-label={copy.header.renameList}
                        />
                      </>
                    ) : (
                      <button
                        type='button'
                        className='flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left'
                        onClick={() => {
                          selectListOption(option)
                        }}
                        draggable={false}
                      >
                        <span
                          className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
                          style={{ backgroundColor: `${optionColor}20` }}
                          aria-hidden='true'
                        >
                          <List
                            className='h-4 w-4'
                            aria-hidden='true'
                            style={{ color: optionColor }}
                          />
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
                            widgetHeaderMenuTextClassName,
                            isSelected
                              ? 'text-foreground'
                              : 'text-muted-foreground group-hover/list:text-foreground'
                          )}
                        >
                          {option.name}
                        </span>
                      </button>
                    )}

                    {!isEditing ? (
                      <div
                        className='flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within/list:opacity-100 group-hover/list:opacity-100'
                        onClick={(event) => event.stopPropagation()}
                      >
                        {option.watchlistId === selectedWatchlist?.id ? (
                          <button
                            type='button'
                            className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              startRenameList(option)
                            }}
                            aria-label={copy.header.renameList}
                            disabled={!canMutateWatchlist || isMutating}
                          >
                            <Pencil className='!h-3.5 !w-3.5' />
                          </button>
                        ) : null}
                        <button
                          type='button'
                          className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setListToDelete(option)
                          }}
                          aria-label={copy.header.deleteList}
                          disabled={!canMutateWatchlist || isMutating || listOptions.length <= 1}
                        >
                          <Trash2 className='!h-3.5 !w-3.5' />
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <WatchlistListActionsButton
          open={listActionsOpen}
          onOpenChange={setListActionsOpen}
          disabled={!workspaceId}
          createListDisabled={!canMutateWatchlist || !workspaceId || isMutating}
          createSectionDisabled={!workspaceId || !canManageContainers || isMutating}
          onCreateList={() => {
            void handleCreateList()
          }}
          importDisabled={
            !canMutateWatchlist || !workspaceId || !hasSelectedWatchlist || isMutating
          }
          exportDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
          onCreateSection={() => {
            void handleCreateSection()
          }}
          onImport={handleImportClick}
          onExport={() => {
            void handleExport()
          }}
        />

        <WidgetHeaderRefreshButton
          label={copy.header.refresh}
          onClick={handleRefreshData}
          disabled={!canEditWidgetParams || !workspaceId || !providerId}
        />

        <input
          ref={fileInputRef}
          type='file'
          accept='.json,application/json'
          className='hidden'
          onChange={handleImportChange}
        />
      </div>
      <AlertDialog
        open={Boolean(listToDelete)}
        onOpenChange={(open) => {
          if (open || pendingAction === 'delete-list') return
          setListToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.header.deleteListDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.header.deleteListDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!canMutateWatchlist || pendingAction === 'delete-list'}>
              {copy.header.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canMutateWatchlist || pendingAction === 'delete-list'}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmRemoveList()
              }}
            >
              {copy.header.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export const renderWatchlistHeader: DashboardWidgetDefinition['renderHeader'] = ({
  context,
  panelId,
  widget,
  canEditWidgetParams,
}) => {
  return {
    left: (
      <WatchlistHeaderLeftControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
        canEditWidgetParams={Boolean(canEditWidgetParams)}
      />
    ),
    center: (
      <WatchlistHeaderCenterControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
        canMutateWatchlist={context?.canWrite === true}
      />
    ),
    right: (
      <WatchlistHeaderRightControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
        canEditWidgetParams={Boolean(canEditWidgetParams)}
        canMutateWatchlist={context?.canWrite === true}
      />
    ),
  }
}
