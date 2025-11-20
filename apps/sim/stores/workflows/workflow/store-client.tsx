'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { WorkflowStore } from '@/stores/workflows/workflow/types'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  getWorkflowStoreForChannel,
  getWorkflowStoreState,
  setWorkflowStoreState,
  subscribeToWorkflowStore,
} from '@/stores/workflows/workflow/store'

const WorkflowStoreContext = createContext<StoreApi<WorkflowStore>>(
  getWorkflowStoreForChannel()
)

export function WorkflowStoreProvider({
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  children,
}: {
  channelId?: string
  children: ReactNode
}) {
  const store = useMemo(() => getWorkflowStoreForChannel(channelId), [channelId])
  return <WorkflowStoreContext.Provider value={store}>{children}</WorkflowStoreContext.Provider>
}

type Selector<T> = (state: WorkflowStore) => T
type EqualityFn<T> = (a: T, b: T) => boolean

function useWorkflowStoreBase(): WorkflowStore
function useWorkflowStoreBase<T>(selector: Selector<T>, equalityFn?: EqualityFn<T>): T
function useWorkflowStoreBase<T>(selector?: Selector<T>, equalityFn?: EqualityFn<T>) {
  const store = useContext(WorkflowStoreContext)
  if (!store) {
    throw new Error('useWorkflowStore must be used within a WorkflowStoreProvider')
  }

  if (!selector) {
    return useStore(store)
  }

  return useStore(store, selector, equalityFn)
}

type UseWorkflowStoreHook = typeof useWorkflowStoreBase & {
  getState: (channelId?: string) => WorkflowStore
  setState: (
    partial: Parameters<StoreApi<WorkflowStore>['setState']>[0],
    replace?: Parameters<StoreApi<WorkflowStore>['setState']>[1]
  ) => void
  setStateForChannel: (
    partial: Parameters<StoreApi<WorkflowStore>['setState']>[0],
    channelId: string,
    replace?: Parameters<StoreApi<WorkflowStore>['setState']>[1]
  ) => void
  subscribe: (
    listener: Parameters<StoreApi<WorkflowStore>['subscribe']>[0],
    channelId?: string
  ) => () => void
}

export const useWorkflowStore = useWorkflowStoreBase as UseWorkflowStoreHook

useWorkflowStore.getState = (channelId?: string) => getWorkflowStoreState(channelId)

useWorkflowStore.setState = (partial, replace) =>
  setWorkflowStoreState(partial, undefined, replace)

useWorkflowStore.setStateForChannel = (partial, channelId, replace) =>
  setWorkflowStoreState(partial, channelId, replace)

useWorkflowStore.subscribe = (listener, channelId) =>
  subscribeToWorkflowStore(listener, channelId)

export { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store'
