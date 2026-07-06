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
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { exportWatchlistAsJson, WATCHLIST_EXPORT_SOURCE } from '@/lib/watchlists/import-export'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
  type WatchlistWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitWatchlistSelectionChange } from '@/widgets/utils/watchlist-selection'
import { useWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import { DataChartListingSelector } from '@/widgets/widgets/data_chart/components/listing-control'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type WatchlistHeaderControlsSlotProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

const resolveWatchlistParams = (widget?: WidgetInstance | null): WatchlistWidgetParams | null => {
  return widget?.params && typeof widget.params === 'object'
    ? (widget.params as WatchlistWidgetParams)
    : null
}

const resolvePairColor = (widget?: WidgetInstance | null): PairColor =>
  ((widget?.pairColor ?? 'gray') as PairColor) ?? 'gray'

const normalizeSelectedListId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const resolveSelectedListId = ({
  params,
  pairColor,
  pairWatchlistId,
}: {
  params: WatchlistWidgetParams | null
  pairColor: PairColor
  pairWatchlistId?: string | null
}) => {
  if (pairColor !== 'gray') return normalizeSelectedListId(pairWatchlistId)
  return normalizeSelectedListId(params?.watchlistId)
}

const buildWatchlistHeaderListingSelectorId = (panelId: string | undefined, widgetKey: string) =>
  `watchlist-header-listing-${panelId ?? 'panel'}-${widgetKey}`

const ROOT_LIST_SELECTOR_ID = '__watchlist_root__'

type WatchlistListOption = {
  id: string
  name: string
  watchlistId: string | null
}

const resolveWatchlistListColor = (option: Pick<WatchlistListOption, 'watchlistId'>) =>
  getEntityIconColor(option.watchlistId)

function emitWatchlistParamsChange({
  params,
  panelId,
  widgetKey,
}: WatchlistWidgetUpdateEventDetail & { panelId?: string; widgetKey?: string }) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<WatchlistWidgetUpdateEventDetail>(WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const resolveNextSectionName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined,
  baseName = 'Section',
  parentId: string | null = null
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'section') continue
    if ((item.parentId ?? null) !== parentId) continue

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

export const resolveNextListName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined,
  baseName = 'Watchlist'
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'list') continue

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

export const WatchlistHeaderLeftControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)

  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return
    emitWatchlistParamsChange({
      params: {
        provider: nextProvider,
      },
      panelId,
      widgetKey,
    })
  }

  const handleSaveProviderSettings = ({
    providerParams,
    auth,
  }: {
    providerParams?: Record<string, unknown>
    auth?: Record<string, unknown>
  }) => {
    emitWatchlistParamsChange({
      params: {
        providerParams,
        auth: auth as WatchlistWidgetParams['auth'],
        runtime: {
          refreshAt: Date.now(),
        },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <MarketProviderControls
      className='min-w-0'
      value={providerId}
      options={providerOptions}
      onChange={handleProviderChange}
      disabled={!workspaceId}
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
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist.header
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const pairColor = resolvePairColor(widget)
  const pairContext = usePairColorContext(pairColor)
  const requestedListId = resolveSelectedListId({
    params,
    pairColor,
    pairWatchlistId: pairContext.watchlistId,
  })
  const selectedDocument = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: workspaceId,
  })
  const selectedWatchlist = selectedDocument.record
  const selectedListId =
    selectedDocument.items.find((item) => item.type === 'list' && item.id === requestedListId)
      ?.id ?? null
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
    const nextWatchlistId = selectedListId ?? selectedWatchlist?.id ?? null
    if (previousWatchlistIdRef.current !== nextWatchlistId) {
      clearPendingListing()
    }
    previousWatchlistIdRef.current = nextWatchlistId
  }, [clearPendingListing, selectedListId, selectedWatchlist?.id])

  const handleListingChange = (listing: ListingOption | null) => {
    updateSelectorInstance(selectorInstanceId, {
      selectedListingValue: toListingValue(listing),
      selectedListing: listing,
    })
  }

  const handleAddListing = async () => {
    if (!workspaceId || !selectedWatchlist || !pendingListing || isAddingListing) {
      return
    }

    try {
      setIsAddingListing(true)
      const item = {
        id: crypto.randomUUID(),
        type: 'listing' as const,
        parentId: selectedListId,
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
    !workspaceId || !providerId || !selectedWatchlist || !pendingListing || isAddingListing

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
  const pairColor = resolvePairColor(widget)
  const pairContext = usePairColorContext(pairColor)
  const setPairContext = useSetPairColorContext()
  const requestedListId = resolveSelectedListId({
    params,
    pairColor,
    pairWatchlistId: pairContext.watchlistId,
  })
  const selectedDocument = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: workspaceId,
  })
  const selectedWatchlist = selectedDocument.record
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const selectedListId =
    selectedDocument.items.find((item) => item.type === 'list' && item.id === requestedListId)
      ?.id ?? null
  const rootListName = copy.header.rootListName
  const listOptions: WatchlistListOption[] = useMemo(() => {
    return [
      { id: ROOT_LIST_SELECTOR_ID, name: rootListName, watchlistId: null },
      ...selectedDocument.items
        .filter((item) => item.type === 'list')
        .map((item) => ({
          id: item.id,
          name: item.label,
          watchlistId: item.id,
        })),
    ]
  }, [rootListName, selectedDocument.items])
  const selectedOptionId = selectedListId ?? ROOT_LIST_SELECTOR_ID
  const selectedOption =
    listOptions.find((option) => option.id === selectedOptionId) ?? listOptions[0] ?? null
  const selectedOptionColor = selectedOption ? resolveWatchlistListColor(selectedOption) : null

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canManageContainers = hasSelectedWatchlist
  const isMutating = Boolean(pendingAction)

  const handleSelectList = (watchlistId: string | null) => {
    if (pairColor !== 'gray') {
      setPairContext(pairColor, { watchlistId })
    }
    emitWatchlistSelectionChange({
      watchlistId,
      panelId,
      widgetKey,
    })
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
    if (!option.watchlistId || isMutating) return
    setEditingListId(option.watchlistId)
    setRenamingListValue(option.name)
  }

  const handleConfirmRemoveList = async () => {
    const watchlistId = listToDelete?.watchlistId
    if (!watchlistId || isMutating) return

    try {
      setPendingAction('delete-list')
      selectedDocument.setItems(
        selectedDocument.items
          .filter((item) => item.id !== watchlistId)
          .map((item) => (item.parentId === watchlistId ? { ...item, parentId: null } : item))
      )
      await selectedDocument.save()
      setListToDelete(null)
      if (selectedListId === watchlistId) {
        handleSelectList(null)
      }
    } catch {
      // Keep the current list in place so the user can retry.
    } finally {
      setPendingAction(null)
    }
  }

  const commitListRename = async () => {
    if (!editingListId) {
      cancelListRename()
      return
    }

    const editingOption = listOptions.find((option) => option.watchlistId === editingListId) ?? null
    if (!editingOption) {
      cancelListRename()
      return
    }

    const nextName = renamingListValue.trim()
    if (!nextName || nextName === editingOption.name) {
      cancelListRename()
      return
    }

    try {
      setPendingAction('rename-list')
      selectedDocument.setItems(
        selectedDocument.items.map((item) =>
          item.type === 'list' && item.id === editingListId ? { ...item, label: nextName } : item
        )
      )
      await selectedDocument.save()
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
    if (listOptions.some((option) => option.watchlistId === editingListId)) return
    cancelListRename()
  }, [editingListId, listOptions])

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !workspaceId || !selectedWatchlist || pendingAction) {
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

  const handleCreateList = async () => {
    if (!workspaceId || !selectedWatchlist || pendingAction) {
      return
    }

    try {
      setPendingAction('list')
      const listId = crypto.randomUUID()
      selectedDocument.setItems([
        ...selectedDocument.items,
        {
          id: listId,
          type: 'list',
          parentId: null,
          label: resolveNextListName(selectedWatchlist, copy.header.defaultWatchlistPrefix),
        },
      ])
      await selectedDocument.save()
      handleSelectList(listId)
    } catch {
      // Save errors leave the existing containers unchanged.
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateSection = async () => {
    if (!workspaceId || !selectedWatchlist || pendingAction) {
      return
    }

    try {
      setPendingAction('section')
      selectedDocument.setItems([
        ...selectedDocument.items,
        {
          id: crypto.randomUUID(),
          type: 'section',
          parentId: selectedListId,
          label: resolveNextSectionName(
            selectedWatchlist,
            copy.header.defaultSectionPrefix,
            selectedListId
          ),
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
    if (!providerId) return
    emitWatchlistParamsChange({
      params: {
        runtime: {
          refreshAt: Date.now(),
        },
      },
      panelId,
      widgetKey,
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
                      disabled={!workspaceId || !selectedWatchlist}
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
                        {selectedOption?.name ?? rootListName}
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
                const isEditing =
                  option.watchlistId !== null && option.watchlistId === editingListId
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
                          disabled={pendingAction === 'rename-list'}
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

                    {!isEditing && option.watchlistId ? (
                      <div
                        className='flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within/list:opacity-100 group-hover/list:opacity-100'
                        onClick={(event) => event.stopPropagation()}
                      >
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
                          disabled={isMutating}
                        >
                          <Pencil className='!h-3.5 !w-3.5' />
                        </button>
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
                          disabled={isMutating}
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
          createListDisabled={!workspaceId || !canManageContainers || isMutating}
          createSectionDisabled={!workspaceId || !canManageContainers || isMutating}
          onCreateList={() => {
            void handleCreateList()
          }}
          importDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
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
          disabled={!workspaceId || !providerId}
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
            <AlertDialogCancel disabled={pendingAction === 'delete-list'}>
              {copy.header.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingAction === 'delete-list'}
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
}) => ({
  left: (
    <WatchlistHeaderLeftControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
  center: (
    <WatchlistHeaderCenterControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
  right: (
    <WatchlistHeaderRightControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
})
