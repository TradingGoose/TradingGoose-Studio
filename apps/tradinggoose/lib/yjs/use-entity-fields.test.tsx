/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { updateWatchlistItems } from '@/lib/yjs/entity-session'
import {
  useSavedEntityYjsSession,
  useSavedEntityYjsSessionCollection,
} from '@/lib/yjs/use-entity-fields'

const providerMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  dispose: vi.fn(),
  disconnect: vi.fn(),
  destroy: vi.fn(),
  connected: true,
  results: [] as Array<{
    doc: Y.Doc
    provider: {
      disconnect: ReturnType<typeof vi.fn>
      emit: (event: string) => void
      shouldConnect: boolean
      ws: object | null
    }
  }>,
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: unknown[]) => providerMocks.bootstrap(...args),
  disposeYjsProvider: (...args: unknown[]) => providerMocks.dispose(...args),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('useSavedEntityYjsSession access mode', () => {
  let container: HTMLDivElement
  let root: Root
  let current: ReturnType<typeof useSavedEntityYjsSession>

  const Harness = ({ accessMode }: { accessMode: ReviewAccessMode }) => {
    current = useSavedEntityYjsSession('watchlist', 'watchlist-1', 'workspace-1', null, accessMode)
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    providerMocks.results.length = 0
    providerMocks.connected = true
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providerMocks.bootstrap.mockImplementation(async (descriptor, _origin, accessMode) => {
      const listeners = new Map<string, Set<() => void>>()
      const doc = new Y.Doc()
      const provider = {
        ws: providerMocks.connected ? {} : null,
        shouldConnect: true,
        disconnect: vi.fn(() => {
          provider.shouldConnect = false
          provider.ws = null
          providerMocks.disconnect()
        }),
        destroy: providerMocks.destroy,
        on: (event: string, listener: () => void) => {
          const current = listeners.get(event) ?? new Set()
          current.add(listener)
          listeners.set(event, current)
        },
        off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
        emit: (event: string) => {
          if (event === 'connection-close' || event === 'connection-error') provider.ws = null
          for (const listener of listeners.get(event) ?? []) listener()
        },
      }
      const result = {
        descriptor,
        doc,
        provider,
        accessMode,
        runtime: { docState: 'active' },
      }
      providerMocks.results.push(result)
      return result
    })
    providerMocks.dispose.mockImplementation((result) => {
      result.provider.disconnect()
      result.provider.destroy()
      result.doc.destroy()
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('rejects a retained writer save after rerendering as a reader', async () => {
    await act(async () => root.render(<Harness accessMode='write' />))
    await vi.waitFor(() => expect(current.doc).toBeInstanceOf(Y.Doc))
    const retainedSave = current.save

    await act(async () => root.render(<Harness accessMode='read' />))

    await expect(retainedSave()).rejects.toThrow('Cannot save a read-only Yjs session')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('disposes a late descriptor result without replacing or destroying the active result', async () => {
    let resolveFirst!: (result: any) => void
    let resolveSecond!: (result: any) => void
    const createResult = (descriptor: any, accessMode: ReviewAccessMode) => {
      const listeners = new Map<string, Set<() => void>>()
      const doc = new Y.Doc()
      return {
        descriptor,
        doc,
        provider: {
          ws: {},
          disconnect: providerMocks.disconnect,
          destroy: providerMocks.destroy,
          on: (event: string, listener: () => void) => {
            const current = listeners.get(event) ?? new Set()
            current.add(listener)
            listeners.set(event, current)
          },
          off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
        },
        accessMode,
        runtime: { docState: 'active' },
      }
    }
    providerMocks.bootstrap.mockImplementation(
      (descriptor, _origin, accessMode) =>
        new Promise((resolve) => {
          if (descriptor.entityId === 'watchlist-a') resolveFirst = resolve
          else resolveSecond = resolve
        })
    )
    const SwitchingHarness = ({ entityId }: { entityId: string }) => {
      current = useSavedEntityYjsSession('watchlist', entityId, 'workspace-1', null, 'read')
      return null
    }

    await act(async () => root.render(<SwitchingHarness entityId='watchlist-a' />))
    await act(async () => root.render(<SwitchingHarness entityId='watchlist-b' />))
    const second = createResult(
      { entityId: 'watchlist-b', entityKind: 'watchlist', yjsSessionId: 'watchlist-b' },
      'read'
    )
    await act(async () => resolveSecond(second))
    expect(current.doc).toBe(second.doc)

    const first = createResult(
      { entityId: 'watchlist-a', entityKind: 'watchlist', yjsSessionId: 'watchlist-a' },
      'read'
    )
    await act(async () => resolveFirst(first))

    expect(providerMocks.dispose).toHaveBeenCalledWith(first)
    expect(providerMocks.dispose).not.toHaveBeenCalledWith(second)
    expect(current.doc).toBe(second.doc)
  })

  it('binds every member of a live entity collection', async () => {
    let collection: ReturnType<typeof useSavedEntityYjsSessionCollection>
    let renderCount = 0
    const CollectionHarness = ({ entityIds }: { entityIds: string[] }) => {
      collection = useSavedEntityYjsSessionCollection(
        'watchlist',
        entityIds,
        'workspace-1',
        null,
        'read'
      )
      renderCount += 1
      return null
    }

    await act(async () => root.render(<CollectionHarness entityIds={['list-1', 'list-2']} />))
    await vi.waitFor(() => expect(collection.documents.size).toBe(2))
    const beforeUpdate = renderCount
    act(() => {
      updateWatchlistItems(collection.documents.get('list-2')!, () => [
        {
          id: 'listing-2',
          type: 'listing',
          parentId: null,
          listing: {
            listing_type: 'default',
            listing_id: 'MSFT',
            base_id: '',
            quote_id: '',
          },
        },
      ])
    })
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(beforeUpdate))

    await act(async () => root.render(<CollectionHarness entityIds={['list-2', 'list-3']} />))
    await vi.waitFor(() => {
      expect([...collection.documents.keys()].sort()).toEqual(['list-2', 'list-3'])
    })
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(4)
  })

  it('keeps a lost read session until its replacement is ready', async () => {
    vi.useFakeTimers()
    const ReadLossHarness = () => {
      current = useSavedEntityYjsSession(
        'watchlist',
        'watchlist-read-loss',
        'workspace-1',
        null,
        'read'
      )
      return null
    }
    await act(async () => root.render(<ReadLossHarness />))
    await act(async () => Promise.resolve())
    const stale = providerMocks.results[0]
    expect(stale).toBeDefined()
    providerMocks.bootstrap.mockRejectedValueOnce(new Error('replacement unavailable'))

    act(() => stale?.provider.emit('connection-close'))

    expect(stale?.provider.shouldConnect).toBe(false)
    expect(stale?.provider.disconnect).toHaveBeenCalledOnce()
    expect(providerMocks.dispose).not.toHaveBeenCalledWith(stale)
    expect(current.doc).toBe(stale?.doc)
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(2)
    expect(providerMocks.dispose).not.toHaveBeenCalledWith(stale)
    expect(current.doc).toBe(stale?.doc)

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(3)
    expect(providerMocks.dispose).toHaveBeenCalledWith(stale)
    expect(providerMocks.dispose).not.toHaveBeenCalledWith(providerMocks.results[1])
    expect(current.doc).toBe(providerMocks.results[1]?.doc)
  })

  it('replaces a disconnected read result only after its connection-loss event', async () => {
    vi.useFakeTimers()
    providerMocks.connected = false
    const BootstrapRaceHarness = () => {
      current = useSavedEntityYjsSession(
        'watchlist',
        'watchlist-bootstrap-race',
        'workspace-1',
        null,
        'read'
      )
      return null
    }

    await act(async () => root.render(<BootstrapRaceHarness />))
    await act(async () => Promise.resolve())

    const disconnected = providerMocks.results[0]
    expect(providerMocks.dispose).not.toHaveBeenCalledWith(disconnected)
    expect(current.doc).toBe(disconnected?.doc)

    providerMocks.connected = true
    act(() => disconnected?.provider.emit('connection-close'))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(2)
    expect(providerMocks.dispose).toHaveBeenCalledWith(disconnected)
    expect(current.doc).toBe(providerMocks.results[1]?.doc)
  })
})
