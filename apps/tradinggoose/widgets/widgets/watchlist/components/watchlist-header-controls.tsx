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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { type ListingOption, toListingValue } from '@/lib/listing/identity'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import {
  exportWatchlistAsJson,
  parseImportedWatchlistFile,
  WATCHLIST_EXPORT_SOURCE,
} from '@/lib/watchlists/import-export'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import {
  resolveWatchlistDocumentItemIds,
  watchlistListingMembershipKey,
} from '@/lib/watchlists/validation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { formatTemplate } from '@/i18n/utils'
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
}

type ListActionFeedback = {
  operation: 'create' | 'delete'
  phase: 'pending' | 'failure'
  name: string
}

const resolveWatchlistListColor = (option: Pick<WatchlistListOption, 'id'>) =>
  getEntityIconColor(option.id)

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
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const actions = useWidgetConfigRuntimeActions()
  const patchWidgetParams = (nextParams: Record<string, unknown>) => {
    if (!canEditWidgetParams) return
    actions.patchWidgetParams?.(nextParams)
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
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist.header
  const { canEdit, isLoading: isPermissionsLoading } = useUserPermissionsContext()
  const canMutateWatchlist = !isPermissionsLoading && canEdit
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const requestedWatchlistId = resolveSelectedWatchlistId({
    params,
  })
  const selectedDocument = useSelectedWatchlistYjsDocument({
    workspaceId: isPermissionsLoading ? null : workspaceId,
    watchlistId: requestedWatchlistId,
    accessMode: canMutateWatchlist ? 'write' : 'read',
  })
  const selectedWatchlist = selectedDocument.record
  const canMutateSelectedWatchlist = canMutateWatchlist && selectedDocument.canMutateDocument
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
      !canMutateSelectedWatchlist ||
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
      selectedDocument.updateItems((items) => [...items, item])
      clearPendingListing()
    } catch {
      // Save errors leave the selector state intact so the user can retry.
    } finally {
      setIsAddingListing(false)
    }
  }

  const addListingDisabled =
    !canMutateSelectedWatchlist ||
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
        <TooltipTrigger
          render={
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
          }
        />
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
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist
  const { canEdit, isLoading: isPermissionsLoading } = useUserPermissionsContext()
  const canMutateWatchlist = !isPermissionsLoading && canEdit
  const [listDropdownOpen, setListDropdownOpen] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [renamingListValue, setRenamingListValue] = useState('')
  const [listToDelete, setListToDelete] = useState<WatchlistListOption | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const renameListInputRef = useRef<HTMLInputElement | null>(null)

  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const actions = useWidgetConfigRuntimeActions()
  const requestedWatchlistId = resolveSelectedWatchlistId({
    params,
  })
  const selectedDocument = useSelectedWatchlistYjsDocument({
    workspaceId: isPermissionsLoading ? null : workspaceId,
    watchlistId: requestedWatchlistId,
    accessMode: canMutateWatchlist ? 'write' : 'read',
  })
  const selectedWatchlist = selectedDocument.record
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [listActionFeedback, setListActionFeedback] = useState<ListActionFeedback | null>(null)
  const listOptions: WatchlistListOption[] = useMemo(() => {
    return selectedDocument.members.map((member) => ({
      id: member.entityId,
      name: member.entityName || 'Watchlist',
    }))
  }, [selectedDocument.members])
  const selectedOptionId = selectedDocument.selectedWatchlistId
  const selectedOption = listOptions.find((option) => option.id === selectedOptionId) ?? null
  const selectedOptionColor = selectedOption ? resolveWatchlistListColor(selectedOption) : null

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canReadSelectedWatchlist = Boolean(
    workspaceId && selectedWatchlist && selectedDocument.isDocumentReady
  )
  const canMutateSelectedWatchlist = canMutateWatchlist && selectedDocument.canMutateDocument
  const canManageContainers = canMutateSelectedWatchlist && hasSelectedWatchlist
  const isMutating = Boolean(pendingAction)
  const listRowActionButtonClassName =
    'flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

  const handleSelectList = (watchlistId: string | null) => {
    if (!canEditWidgetParams) return
    actions.patchWidgetLinkedParams?.({ watchlistId })
  }

  const selectListOption = (option: WatchlistListOption) => {
    cancelListRename()
    handleSelectList(option.id)
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
    if (!canMutateWatchlist || isMutating) return
    setEditingListId(option.id)
    setRenamingListValue(option.name)
  }

  const handleCreateList = async () => {
    if (!canMutateWatchlist || !workspaceId || pendingAction) {
      return
    }

    const name = resolveNextWatchlistName(
      selectedDocument.members,
      copy.header.defaultWatchlistPrefix
    )

    try {
      setPendingAction('create-list')
      setListActionFeedback({ operation: 'create', phase: 'pending', name })
      const response = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.watchlist?.id) {
        throw new Error(payload?.error || 'Failed to create watchlist')
      }
      handleSelectList(payload.watchlist.id)
      setListActionFeedback(null)
    } catch {
      setListActionFeedback({ operation: 'create', phase: 'failure', name })
    } finally {
      setPendingAction(null)
    }
  }

  const handleConfirmRemoveList = async () => {
    const watchlistId = listToDelete?.id
    const watchlistName = listToDelete?.name
    if (
      !canMutateWatchlist ||
      !workspaceId ||
      !watchlistId ||
      !watchlistName ||
      pendingAction ||
      listOptions.length <= 1
    )
      return

    try {
      setPendingAction('delete-list')
      setListActionFeedback({
        operation: 'delete',
        phase: 'pending',
        name: watchlistName,
      })
      const nextOption = listOptions.find((option) => option.id !== watchlistId) ?? null
      const response = await fetch(
        `/api/watchlists/${encodeURIComponent(watchlistId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to delete watchlist')
      }
      setListToDelete(null)
      setListActionFeedback(null)
      if (selectedOptionId === watchlistId) {
        handleSelectList(nextOption?.id ?? null)
      }
    } catch {
      setListActionFeedback({
        operation: 'delete',
        phase: 'failure',
        name: watchlistName,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const commitListRename = async () => {
    const optionBeingRenamed = editingListId
      ? (listOptions.find((option) => option.id === editingListId) ?? null)
      : null

    if (!canMutateWatchlist || !workspaceId || !editingListId || !optionBeingRenamed) {
      cancelListRename()
      return
    }

    const nextName = renamingListValue.trim()
    if (!nextName || nextName === optionBeingRenamed.name) {
      cancelListRename()
      return
    }

    try {
      setPendingAction('rename-list')
      await renameSavedEntityAction({
        entityKind: 'watchlist',
        entityId: editingListId,
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
      event.stopPropagation()
      void commitListRename()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelListRename()
      return
    }

    // Keep the dropdown's typeahead and arrow-key navigation from stealing
    // keystrokes while the inline rename input is focused.
    event.stopPropagation()
  }

  useEffect(() => {
    if (!editingListId) return
    renameListInputRef.current?.focus()
    renameListInputRef.current?.select()
  }, [editingListId])

  useEffect(() => {
    if (!editingListId) return
    if (listOptions.some((option) => option.id === editingListId)) return
    cancelListRename()
  }, [editingListId, listOptions])

  const handleImportClick = () => {
    if (canMutateSelectedWatchlist) fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (
      !canMutateSelectedWatchlist ||
      !file ||
      !workspaceId ||
      !selectedWatchlist ||
      pendingAction
    ) {
      event.target.value = ''
      return
    }

    try {
      setPendingAction('import')
      const content = await file.text()
      const imported = parseImportedWatchlistFile(JSON.parse(content) as unknown)
      const importedItems = resolveWatchlistDocumentItemIds(imported.items, new Set<string>())
      selectedDocument.updateItems((items) => {
        const memberships = new Set<string>()
        return [...items, ...importedItems].filter((item) => {
          if (item.type === 'section') return true
          const key = watchlistListingMembershipKey(item.parentId, item.listing)
          if (memberships.has(key)) return false
          memberships.add(key)
          return true
        })
      })
    } catch {
      // Invalid files or save errors leave the existing watchlist unchanged.
    } finally {
      setPendingAction(null)
      event.target.value = ''
    }
  }

  const handleExport = async () => {
    if (!canReadSelectedWatchlist || !selectedWatchlist || pendingAction) return
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
    if (!canMutateSelectedWatchlist || !workspaceId || !selectedWatchlist || pendingAction) {
      return
    }

    try {
      setPendingAction('section')
      selectedDocument.updateItems((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          type: 'section',
          parentId: null,
          label: resolveNextSectionName(selectedWatchlist, copy.header.defaultSectionPrefix),
        },
      ])
    } catch {
      // Save errors leave the existing containers unchanged.
    } finally {
      setPendingAction(null)
    }
  }

  const handleRefreshData = () => {
    if (!canEditWidgetParams || !providerId) return
    actions.patchWidgetParams?.({
      runtime: {
        refreshAt: Date.now(),
      },
    })
  }

  const listActionFeedbackMessage = listActionFeedback
    ? formatTemplate(
        listActionFeedback.operation === 'create'
          ? listActionFeedback.phase === 'pending'
            ? copy.header.creatingList
            : copy.header.createListFailed
          : listActionFeedback.phase === 'pending'
            ? copy.header.deletingList
            : copy.header.deleteListFailed,
        { name: listActionFeedback.name }
      )
    : null
  const listActionFeedbackNode =
    listActionFeedback && listActionFeedbackMessage ? (
      <p
        role={listActionFeedback.phase === 'failure' ? 'alert' : 'status'}
        aria-atomic='true'
        className={cn(
          'text-xs',
          listActionFeedback.phase === 'failure' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {listActionFeedbackMessage}
      </p>
    ) : null

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
              <TooltipTrigger
                render={
                  <span className='inline-flex'>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type='button'
                          disabled={
                            !workspaceId || !canEditWidgetParams || listOptions.length === 0
                          }
                          className={widgetHeaderControlClassName(
                            'group flex min-w-[240px] items-center justify-between gap-1'
                          )}
                          aria-label={copy.header.explorer}
                        />
                      }
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
                        className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180'
                        aria-hidden='true'
                      />
                    </DropdownMenuTrigger>
                  </span>
                }
              />
              <TooltipContent side='top'>
                {!workspaceId ? copy.header.selectWorkspace : copy.header.explorer}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align='end'
              sideOffset={6}
              className={cn(
                widgetHeaderMenuContentClassName,
                'max-h-[20rem] w-[240px] overflow-y-auto shadow-lg'
              )}
              onWheel={(event) => event.stopPropagation()}
            >
              {listOptions.map((option) => {
                const isSelected = option.id === selectedOptionId
                const optionColor = resolveWatchlistListColor(option)
                const isEditingOption = editingListId === option.id

                const optionBadge = (
                  <span
                    className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
                    style={{ backgroundColor: `${optionColor}20` }}
                    aria-hidden='true'
                  >
                    <List className='h-4 w-4' aria-hidden='true' style={{ color: optionColor }} />
                  </span>
                )

                if (isEditingOption) {
                  return (
                    <div
                      key={option.id}
                      className={cn(widgetHeaderMenuItemClassName, 'cursor-text')}
                    >
                      {optionBadge}
                      <input
                        ref={renameListInputRef}
                        value={renamingListValue}
                        onChange={(event) => setRenamingListValue(event.target.value)}
                        onBlur={() => {
                          void commitListRename()
                        }}
                        onKeyDown={handleListRenameKeyDown}
                        onPointerDown={(event) => event.stopPropagation()}
                        className='min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-foreground text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                        maxLength={100}
                        disabled={!canMutateWatchlist || pendingAction === 'rename-list'}
                        autoComplete='off'
                        autoCorrect='off'
                        autoCapitalize='off'
                        spellCheck='false'
                        aria-label={copy.header.renameList}
                      />
                    </div>
                  )
                }

                return (
                  <DropdownMenuItem
                    key={option.id}
                    data-active={isSelected ? '' : undefined}
                    onClick={() => {
                      selectListOption(option)
                    }}
                    className={cn(
                      widgetHeaderMenuItemClassName,
                      'justify-between',
                      isSelected
                        ? 'bg-secondary/60 text-foreground hover:bg-secondary/60'
                        : undefined
                    )}
                  >
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                      {optionBadge}
                      <span
                        className={cn(
                          widgetHeaderMenuTextClassName,
                          'min-w-0 flex-1 select-none truncate',
                          isSelected ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {option.name}
                      </span>
                    </div>
                    {canMutateWatchlist ? (
                      <div className='pointer-events-none flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'>
                        <button
                          type='button'
                          disabled={isMutating}
                          className={listRowActionButtonClassName}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            startRenameList(option)
                          }}
                        >
                          <Pencil className={widgetHeaderMenuIconClassName} aria-hidden='true' />
                          <span className='sr-only'>
                            {copy.header.renameList}: {option.name}
                          </span>
                        </button>
                        {listOptions.length > 1 && (
                          <button
                            type='button'
                            disabled={isMutating}
                            className={listRowActionButtonClassName}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setListDropdownOpen(false)
                              setListActionFeedback(null)
                              setListToDelete(option)
                            }}
                          >
                            <Trash2 className={widgetHeaderMenuIconClassName} aria-hidden='true' />
                            <span className='sr-only'>
                              {copy.header.deleteList}: {option.name}
                            </span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <WatchlistListActionsButton
          disabled={!workspaceId}
          createListDisabled={!canMutateWatchlist || !workspaceId || isMutating}
          createSectionDisabled={!workspaceId || !canManageContainers || isMutating}
          onCreateList={() => {
            void handleCreateList()
          }}
          importDisabled={
            !canMutateSelectedWatchlist || !workspaceId || !hasSelectedWatchlist || isMutating
          }
          exportDisabled={!canReadSelectedWatchlist || isMutating}
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
      {listActionFeedback?.operation === 'create' && listActionFeedbackNode}
      <AlertDialog
        open={Boolean(listToDelete)}
        onOpenChange={(open, details) => {
          if (open) return
          if (pendingAction === 'delete-list') return details.cancel()
          setListToDelete(null)
          if (listActionFeedback?.operation === 'delete') {
            setListActionFeedback(null)
          }
        }}
      >
        <AlertDialogContent hideCloseButton={pendingAction === 'delete-list'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.header.deleteListDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.header.deleteListDialogDescription}
            </AlertDialogDescription>
            {listActionFeedback?.operation === 'delete' && listActionFeedbackNode}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!canMutateWatchlist || pendingAction === 'delete-list'}>
              {copy.header.cancel}
            </AlertDialogCancel>
            <Button
              type='button'
              disabled={!canMutateWatchlist || pendingAction === 'delete-list'}
              aria-busy={pendingAction === 'delete-list' || undefined}
              onClick={() => void handleConfirmRemoveList()}
            >
              {pendingAction === 'delete-list' && listActionFeedback
                ? formatTemplate(copy.header.deletingList, { name: listActionFeedback.name })
                : copy.header.delete}
            </Button>
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
      />
    ),
    right: (
      <WatchlistHeaderRightControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
        canEditWidgetParams={Boolean(canEditWidgetParams)}
      />
    ),
  }
}
