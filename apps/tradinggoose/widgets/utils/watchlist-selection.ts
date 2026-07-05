import { WATCHLIST_WIDGET_SELECT_EVENT } from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createEmitSelectionChange,
  createSelectionPersistenceHook,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

const useWatchlistSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: WATCHLIST_WIDGET_SELECT_EVENT,
  detailIdKey: 'watchlistId',
})

interface UseWatchlistSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onWatchlistSelect?: (watchlistId: string | null) => void
  scopeKey: string
}

export function useWatchlistSelectionPersistence({
  onWatchlistSelect,
  ...rest
}: UseWatchlistSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onWatchlistSelect,
  }
  useWatchlistSelectionPersistenceGeneric(opts)
}

const emitGeneric = createEmitSelectionChange({
  eventName: WATCHLIST_WIDGET_SELECT_EVENT,
  detailIdKey: 'watchlistId',
})

interface EmitWatchlistSelectionOptions {
  watchlistId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitWatchlistSelectionChange({
  watchlistId,
  ...rest
}: EmitWatchlistSelectionOptions) {
  emitGeneric({ ...rest, entityId: watchlistId })
}
