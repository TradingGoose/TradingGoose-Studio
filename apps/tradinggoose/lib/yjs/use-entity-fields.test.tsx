/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { replaceEntityListSessionMembers, updateWatchlistItems } from '@/lib/yjs/entity-session'
import {
  useEntityList,
  useSavedEntityYjsSession,
  useSavedEntityYjsSessionCollection,
} from '@/lib/yjs/use-entity-fields'

const providerMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  queuedDocs: [] as Y.Doc[],
  results: [] as any[],
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: unknown[]) => providerMocks.bootstrap(...args),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function createResult(descriptor: any) {
  const doc = providerMocks.queuedDocs.shift() ?? new Y.Doc()
  let resolveLifecycle!: (event: unknown) => void
  const lifecycle = new Promise((resolve) => {
    resolveLifecycle = resolve
  })
  const result = {
    descriptor,
    doc,
    provider: {},
    lifecycle,
    dispose: vi.fn(() => doc.destroy()),
    emitLifecycle: resolveLifecycle,
  }
  providerMocks.results.push(result)
  return result
}

describe('shared entity Yjs sessions', () => {
  let container: HTMLDivElement
  let root: Root
  let current: ReturnType<typeof useSavedEntityYjsSession>

  const Harness = ({ accessMode }: { accessMode: ReviewAccessMode }) => {
    current = useSavedEntityYjsSession('watchlist', 'watchlist-1', 'workspace-1', null, accessMode)
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    providerMocks.queuedDocs.length = 0
    providerMocks.results.length = 0
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providerMocks.bootstrap.mockImplementation(async (descriptor) => createResult(descriptor))
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps a terminal session closed and rejects a retained writer save as a reader', async () => {
    await act(async () => root.render(<Harness accessMode='write' />))
    await vi.waitFor(() => expect(current.doc).toBeInstanceOf(Y.Doc))
    const retainedSave = current.save
    const result = providerMocks.results[0]

    await act(async () =>
      result.emitLifecycle({
        type: 'terminal-failure',
        error: Object.assign(new Error('Authorization revoked'), { retryable: false as const }),
      })
    )
    await vi.waitFor(() => expect(current.error).toBe('Authorization revoked'))
    expect(current.isTerminalError).toBe(true)
    expect(result.dispose).toHaveBeenCalledOnce()

    vi.useFakeTimers()
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(providerMocks.bootstrap).toHaveBeenCalledOnce()
    vi.useRealTimers()

    await act(async () => root.render(<Harness accessMode='read' />))
    await expect(retainedSave()).rejects.toThrow('Cannot save a read-only Yjs session')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps dashboard list members scoped to the current owner', async () => {
    let currentList!: ReturnType<typeof useEntityList>
    const snapshots: Array<{ ownerUserId: string; memberIds: string[] }> = []
    const ListHarness = ({ ownerUserId }: { ownerUserId: string }) => {
      currentList = useEntityList('dashboard_layout', 'workspace-1', ownerUserId)
      snapshots.push({
        ownerUserId,
        memberIds: currentList.members.map((member) => member.entityId),
      })
      return null
    }
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    replaceEntityListSessionMembers(firstDoc, [{ id: 'layout-a', name: 'Layout A' }])
    replaceEntityListSessionMembers(secondDoc, [{ id: 'layout-b', name: 'Layout B' }])
    providerMocks.queuedDocs.push(firstDoc, secondDoc)

    await act(async () => root.render(<ListHarness ownerUserId='user-a' />))
    await vi.waitFor(() =>
      expect(currentList.members.map(({ entityId }) => entityId)).toEqual(['layout-a'])
    )

    snapshots.length = 0
    await act(async () => root.render(<ListHarness ownerUserId='user-b' />))

    expect(
      snapshots
        .filter((snapshot) => snapshot.ownerUserId === 'user-b')
        .every((snapshot) => !snapshot.memberIds.includes('layout-a'))
    ).toBe(true)
    await vi.waitFor(() =>
      expect(currentList.members.map(({ entityId }) => entityId)).toEqual(['layout-b'])
    )
    expect(providerMocks.bootstrap).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ownerUserId: 'user-b',
        yjsSessionId: 'list:dashboard_layout:workspace-1:user:user-b',
      }),
      undefined,
      'read',
      undefined
    )
  })

  it('disposes a late dashboard list result without replacing the active owner', async () => {
    let resolveFirst!: (result: any) => void
    let resolveSecond!: (result: any) => void
    providerMocks.bootstrap.mockImplementation(
      (descriptor) =>
        new Promise((resolve) => {
          if (descriptor.ownerUserId === 'user-a') resolveFirst = resolve
          else resolveSecond = resolve
        })
    )
    let currentList!: ReturnType<typeof useEntityList>
    const SwitchingHarness = ({ ownerUserId }: { ownerUserId: string }) => {
      currentList = useEntityList('dashboard_layout', 'workspace-1', ownerUserId)
      return null
    }

    await act(async () => root.render(<SwitchingHarness ownerUserId='user-a' />))
    await act(async () => root.render(<SwitchingHarness ownerUserId='user-b' />))
    const second = createResult({ ownerUserId: 'user-b' })
    replaceEntityListSessionMembers(second.doc, [{ id: 'layout-b', name: 'Layout B' }])
    await act(async () => resolveSecond(second))
    await vi.waitFor(() =>
      expect(currentList.members.map(({ entityId }) => entityId)).toEqual(['layout-b'])
    )
    const first = createResult({ ownerUserId: 'user-a' })
    await act(async () => resolveFirst(first))

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.dispose).not.toHaveBeenCalled()
    expect(currentList.members.map(({ entityId }) => entityId)).toEqual(['layout-b'])
  })

  it('binds every member of a live entity collection', async () => {
    let collection: ReturnType<typeof useSavedEntityYjsSessionCollection>
    let renderCount = 0
    const CollectionHarness = () => {
      collection = useSavedEntityYjsSessionCollection(
        'watchlist',
        ['list-1', 'list-2'],
        'workspace-1',
        null,
        'read'
      )
      renderCount += 1
      return null
    }

    await act(async () => root.render(<CollectionHarness />))
    await vi.waitFor(() => expect(collection.documents.size).toBe(2))
    const beforeUpdate = renderCount
    act(() => {
      updateWatchlistItems(collection.documents.get('list-2')!, () => [])
    })
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(beforeUpdate))
  })

  it('drops a stale list before opening a fresh Yjs history', async () => {
    vi.useFakeTimers()
    let currentList!: ReturnType<typeof useEntityList>
    const ListHarness = () => {
      currentList = useEntityList('watchlist', 'workspace-1')
      return null
    }
    await act(async () => root.render(<ListHarness />))
    await act(async () => Promise.resolve())
    const stale = providerMocks.results[0]
    replaceEntityListSessionMembers(stale.doc, [
      { id: 'kept', name: 'Kept' },
      { id: 'removed', name: 'Removed' },
    ])
    await act(async () => Promise.resolve())
    expect(currentList.members).toHaveLength(2)

    providerMocks.bootstrap.mockRejectedValueOnce(new Error('replacement unavailable'))
    const replacement = new Y.Doc()
    replaceEntityListSessionMembers(replacement, [{ id: 'kept', name: 'Kept' }])
    providerMocks.queuedDocs.push(replacement)
    await act(async () => stale.emitLifecycle({ type: 'resync-required' }))
    expect(currentList.members).toEqual([])
    expect(stale.dispose).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(currentList.members).toEqual([])

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(currentList.members.map(({ entityId }) => entityId)).toEqual(['kept'])
  })
})
