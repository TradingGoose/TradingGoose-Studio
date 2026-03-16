'use client'

import { type ChangeEvent, useMemo, useRef, useState } from 'react'
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
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { normalizeWatchlistItems } from '@/lib/watchlists/validation'
import {
  useAddWatchlistSection,
  useClearWatchlist,
  useCreateWatchlist,
  useDeleteWatchlist,
  useExportWatchlist,
  useImportWatchlist,
  useRenameWatchlist,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import type { WidgetInstance } from '@/widgets/layout'
import {
  WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT,
  type WatchlistWidgetAddDraftSymbolEventDetail,
} from '@/widgets/events'
import { emitWatchlistParamsChange } from '@/widgets/utils/watchlist-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import { WatchlistListSelector } from '@/widgets/widgets/watchlist/components/watchlist-list-selector'
import {
  resolveWatchlistProviderCredentialDefinitions,
  WatchlistProviderSettingsButton,
} from '@/widgets/widgets/watchlist/components/provider-controls'
import { WatchlistRefreshDataButton } from '@/widgets/widgets/watchlist/components/watchlist-refresh-data-button'
import {
  resolveSelectedWatchlist,
  resolveSelectedWatchlistId,
} from '@/widgets/widgets/watchlist/components/watchlist-selection'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type WatchlistHeaderControlsSlotProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  const fromParams = typeof params?.provider === 'string' ? params.provider.trim() : ''
  if (fromParams) return fromParams
  return providerOptions[0]?.id ?? ''
}

const toEpochMs = (value?: string | null) => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const resolveWatchlistParams = (widget?: WidgetInstance | null): WatchlistWidgetParams | null => {
  return widget?.params && typeof widget.params === 'object'
    ? (widget.params as WatchlistWidgetParams)
    : null
}

export const resolveNextWatchlistName = (watchlists: Array<{ name: string }>) => {
  const usedNumbers = new Set<number>()

  for (const watchlist of watchlists) {
    const match = watchlist.name.trim().match(/^Watchlist\s+(\d+)$/i)
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

  return `Watchlist ${nextNumber}`
}

export const resolveNextSectionName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'section') continue

    const match = item.label.trim().match(/^Section\s+(\d+)$/i)
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

  return `Section ${nextNumber}`
}

const useWatchlistSelection = (workspaceId?: string, selectedWatchlistId?: string | null) => {
  const { data: watchlists = [] } = useWatchlists(workspaceId)
  const selectedWatchlist = useMemo(
    () => resolveSelectedWatchlist(watchlists, selectedWatchlistId ?? null),
    [watchlists, selectedWatchlistId]
  )

  return {
    watchlists,
    selectedWatchlist,
  }
}

export const WatchlistHeaderLeftControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const credentialDefinitions = useMemo(
    () => resolveWatchlistProviderCredentialDefinitions(providerId),
    [providerId]
  )

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
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistProviderSettingsButton
        providerId={providerId}
        providerParams={params?.providerParams}
        authParams={params?.auth}
        definitions={credentialDefinitions}
        workspaceId={workspaceId}
        onSave={handleSaveProviderSettings}
      />
      <MarketProviderSelector
        value={providerId}
        options={providerOptions}
        onChange={handleProviderChange}
        disabled={!workspaceId}
      />

      <WatchlistRefreshDataButton
        onClick={handleRefreshData}
        disabled={!workspaceId || !providerId}
      />
    </div>
  )
}

export const WatchlistHeaderCenterControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const selectedWatchlistId = resolveSelectedWatchlistId(params)

  const { watchlists, selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)

  const renameMutation = useRenameWatchlist()
  const deleteMutation = useDeleteWatchlist()

  const orderedWatchlists = useMemo(
    () =>
      [...watchlists].sort((left, right) => toEpochMs(right.createdAt) - toEpochMs(left.createdAt)),
    [watchlists]
  )

  const handleSelectWatchlist = (watchlistId: string) => {
    emitWatchlistParamsChange({
      params: {
        watchlistId,
      },
      panelId,
      widgetKey,
    })
  }

  const handleRenameWatchlist = async (watchlistId: string, nextName: string) => {
    if (!workspaceId || renameMutation.isPending) {
      return false
    }

    const target = watchlists.find((entry) => entry.id === watchlistId)
    if (!target || target.isSystem) return false

    const trimmed = nextName.trim()
    if (!trimmed || trimmed === target.name) {
      return true
    }

    try {
      await renameMutation.mutateAsync({
        workspaceId,
        watchlistId: target.id,
        name: trimmed,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  const handleDeleteWatchlist = async (watchlistId: string) => {
    if (!workspaceId || deleteMutation.isPending) return false
    const target = watchlists.find((entry) => entry.id === watchlistId)
    if (!target || target.isSystem) return false
    try {
      await deleteMutation.mutateAsync({
        workspaceId,
        watchlistId: target.id,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistListSelector
        watchlists={orderedWatchlists}
        selectedWatchlist={selectedWatchlist}
        onSelect={handleSelectWatchlist}
        onRenameWatchlist={handleRenameWatchlist}
        onDeleteWatchlist={handleDeleteWatchlist}
        isRenamingWatchlist={renameMutation.isPending}
        isDeletingWatchlist={deleteMutation.isPending}
        disabled={!workspaceId}
      />
    </div>
  )
}

export const WatchlistHeaderRightControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const [listActionsOpen, setListActionsOpen] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const selectedWatchlistId = resolveSelectedWatchlistId(params)

  const { watchlists, selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)

  const createMutation = useCreateWatchlist()
  const addSectionMutation = useAddWatchlistSection()
  const deleteMutation = useDeleteWatchlist()
  const clearMutation = useClearWatchlist()
  const importMutation = useImportWatchlist()
  const exportMutation = useExportWatchlist()

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canAddSymbol = hasSelectedWatchlist
  const canManageSections = hasSelectedWatchlist
  const canManageCurrentList = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)
  const canDeleteCurrent = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)
  const isMutating =
    createMutation.isPending ||
    addSectionMutation.isPending ||
    deleteMutation.isPending ||
    clearMutation.isPending ||
    importMutation.isPending ||
    exportMutation.isPending

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !workspaceId || !selectedWatchlist || importMutation.isPending) {
      event.target.value = ''
      return
    }

    try {
      const content = await file.text()
      const parsed = JSON.parse(content) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid watchlist import file')
      }

      const items = normalizeWatchlistItems(parsed)
      if (items.length !== parsed.length) {
        throw new Error('Invalid watchlist import file')
      }
      await importMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        items,
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    } finally {
      event.target.value = ''
    }
  }

  const handleExport = async () => {
    if (!workspaceId || !selectedWatchlist || exportMutation.isPending) return
    try {
      const result = await exportMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })

      const blob = new Blob([result.content], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleClearWatchlist = async () => {
    if (
      !workspaceId ||
      !selectedWatchlist ||
      selectedWatchlist.isSystem ||
      clearMutation.isPending
    ) {
      return
    }

    try {
      await clearMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })
      setClearDialogOpen(false)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleCreateWatchlist = async () => {
    if (!workspaceId || createMutation.isPending) return

    try {
      const watchlist = await createMutation.mutateAsync({
        workspaceId,
        name: resolveNextWatchlistName(watchlists),
      })
      emitWatchlistParamsChange({
        params: {
          watchlistId: watchlist.id,
        },
        panelId,
        widgetKey,
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleAddSymbol = () => {
    if (!workspaceId || !selectedWatchlist || isMutating) return

    window.dispatchEvent(
      new CustomEvent<WatchlistWidgetAddDraftSymbolEventDetail>(
        WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT,
        {
          detail: {
            panelId,
            widgetKey,
          },
        }
      )
    )
  }

  const handleCreateSection = async () => {
    if (!workspaceId || !selectedWatchlist || addSectionMutation.isPending) {
      return
    }

    try {
      await addSectionMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        label: resolveNextSectionName(selectedWatchlist),
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleDeleteWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    try {
      await deleteMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })
      setDeleteDialogOpen(false)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistListActionsButton
        open={listActionsOpen}
        onOpenChange={setListActionsOpen}
        disabled={!workspaceId}
        addSymbolDisabled={!workspaceId || !canAddSymbol || isMutating}
        createWatchlistDisabled={!workspaceId || createMutation.isPending}
        createSectionDisabled={!workspaceId || !canManageSections || isMutating}
        importDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        exportDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        clearListDisabled={!workspaceId || !canManageCurrentList || isMutating}
        deleteWatchlistDisabled={!workspaceId || !canDeleteCurrent || isMutating}
        onAddSymbol={handleAddSymbol}
        onCreateWatchlist={() => {
          void handleCreateWatchlist()
        }}
        onCreateSection={() => {
          void handleCreateSection()
        }}
        onImport={handleImportClick}
        onExport={() => {
          void handleExport()
        }}
        onClearList={() => {
          setDeleteDialogOpen(false)
          setClearDialogOpen(true)
        }}
        onDeleteWatchlist={() => {
          setClearDialogOpen(false)
          setDeleteDialogOpen(true)
        }}
      />

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear list?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedWatchlist
                ? `This action will remove all symbols from "${selectedWatchlist.name}".`
                : 'This action will remove all symbols from this watchlist.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleClearWatchlist()
              }}
            >
              Clear list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedWatchlist
                ? `This action will permanently delete "${selectedWatchlist.name}".`
                : 'This action will permanently delete this watchlist.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteWatchlist()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleImportChange}
      />
    </div>
  )
}
