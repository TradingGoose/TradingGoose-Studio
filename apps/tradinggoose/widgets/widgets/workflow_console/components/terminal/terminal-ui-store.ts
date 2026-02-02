'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { SortConfig, TerminalFilters } from './types'

interface UiState {
  filters: TerminalFilters
  sortConfig: SortConfig
  detailView: {
    showInput: boolean
    structuredView: boolean
    wrapText: boolean
  }
}

const createDefaultFilters = (): TerminalFilters => ({
  blockIds: new Set(),
  statuses: new Set(),
})

const createDefaultState = (): UiState => ({
  filters: createDefaultFilters(),
  sortConfig: { field: 'timestamp', direction: 'desc' },
  detailView: {
    showInput: false,
    structuredView: true,
    wrapText: true,
  },
})

interface WorkflowConsoleUiStore {
  byKey: Record<string, UiState>
  initKey: (key: string) => void
  toggleBlock: (key: string, blockId: string) => void
  toggleStatus: (key: string, status: 'error' | 'info') => void
  toggleSort: (key: string) => void
  clearFilters: (key: string) => void
  setShowInput: (key: string, showInput: boolean) => void
  toggleStructuredView: (key: string) => void
  toggleWrapText: (key: string) => void
}

export const useWorkflowConsoleUiStore = create<WorkflowConsoleUiStore>((set, get) => ({
  byKey: {},
  initKey: (key) =>
    set((state) => {
      if (!key || state.byKey[key]) return state
      return { ...state, byKey: { ...state.byKey, [key]: createDefaultState() } }
    }),
  toggleBlock: (key, blockId) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      const blockIds = new Set(current.filters.blockIds)
      if (blockIds.has(blockId)) {
        blockIds.delete(blockId)
      } else {
        blockIds.add(blockId)
      }
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            filters: { ...current.filters, blockIds },
          },
        },
      }
    }),
  toggleStatus: (key, status) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      const statuses = new Set(current.filters.statuses)
      if (statuses.has(status)) {
        statuses.delete(status)
      } else {
        statuses.add(status)
      }
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            filters: { ...current.filters, statuses },
          },
        },
      }
    }),
  toggleSort: (key) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            sortConfig: {
              field: current.sortConfig.field,
              direction: current.sortConfig.direction === 'desc' ? 'asc' : 'desc',
            },
          },
        },
      }
    }),
  clearFilters: (key) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            filters: createDefaultFilters(),
          },
        },
      }
    }),
  setShowInput: (key, showInput) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            detailView: {
              ...current.detailView,
              showInput,
            },
          },
        },
      }
    }),
  toggleStructuredView: (key) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            detailView: {
              ...current.detailView,
              structuredView: !current.detailView.structuredView,
            },
          },
        },
      }
    }),
  toggleWrapText: (key) =>
    set((state) => {
      const current = state.byKey[key] ?? createDefaultState()
      return {
        ...state,
        byKey: {
          ...state.byKey,
          [key]: {
            ...current,
            detailView: {
              ...current.detailView,
              wrapText: !current.detailView.wrapText,
            },
          },
        },
      }
    }),
}))

export function useWorkflowConsoleUiState(uiKey: string) {
  const initKey = useWorkflowConsoleUiStore((state) => state.initKey)
  const filters = useWorkflowConsoleUiStore(
    (state) => state.byKey[uiKey]?.filters ?? createDefaultFilters()
  )
  const sortConfig = useWorkflowConsoleUiStore(
    (state) => state.byKey[uiKey]?.sortConfig ?? createDefaultState().sortConfig
  )
  const toggleBlock = useWorkflowConsoleUiStore((state) => state.toggleBlock)
  const toggleStatus = useWorkflowConsoleUiStore((state) => state.toggleStatus)
  const toggleSort = useWorkflowConsoleUiStore((state) => state.toggleSort)
  const clearFilters = useWorkflowConsoleUiStore((state) => state.clearFilters)
  const detailView = useWorkflowConsoleUiStore(
    (state) => state.byKey[uiKey]?.detailView ?? createDefaultState().detailView
  )
  const setShowInput = useWorkflowConsoleUiStore((state) => state.setShowInput)
  const toggleStructuredView = useWorkflowConsoleUiStore((state) => state.toggleStructuredView)
  const toggleWrapText = useWorkflowConsoleUiStore((state) => state.toggleWrapText)

  useEffect(() => {
    if (!uiKey) return
    initKey(uiKey)
  }, [initKey, uiKey])

  const hasActiveFilters = useMemo(
    () => filters.blockIds.size > 0 || filters.statuses.size > 0,
    [filters]
  )

  const handleToggleBlock = useCallback(
    (blockId: string) => toggleBlock(uiKey, blockId),
    [toggleBlock, uiKey]
  )
  const handleToggleStatus = useCallback(
    (status: 'error' | 'info') => toggleStatus(uiKey, status),
    [toggleStatus, uiKey]
  )
  const handleToggleSort = useCallback(() => toggleSort(uiKey), [toggleSort, uiKey])
  const handleClearFilters = useCallback(() => clearFilters(uiKey), [clearFilters, uiKey])
  const handleSetShowInput = useCallback(
    (showInput: boolean) => setShowInput(uiKey, showInput),
    [setShowInput, uiKey]
  )
  const handleToggleStructuredView = useCallback(
    () => toggleStructuredView(uiKey),
    [toggleStructuredView, uiKey]
  )
  const handleToggleWrapText = useCallback(() => toggleWrapText(uiKey), [toggleWrapText, uiKey])

  return {
    filters,
    sortConfig,
    hasActiveFilters,
    detailView,
    toggleBlock: handleToggleBlock,
    toggleStatus: handleToggleStatus,
    toggleSort: handleToggleSort,
    clearFilters: handleClearFilters,
    setShowInput: handleSetShowInput,
    toggleStructuredView: handleToggleStructuredView,
    toggleWrapText: handleToggleWrapText,
  }
}
