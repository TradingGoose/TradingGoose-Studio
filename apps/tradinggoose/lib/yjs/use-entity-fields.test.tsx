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
  disconnect: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: unknown[]) => providerMocks.bootstrap(...args),
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providerMocks.bootstrap.mockImplementation(async (descriptor) => ({
      descriptor,
      doc: new Y.Doc(),
      provider: {
        disconnect: providerMocks.disconnect,
        destroy: providerMocks.destroy,
      },
    }))
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

  it('reuses shared read sessions for a live entity collection', async () => {
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
    expect(providerMocks.bootstrap).toHaveBeenCalledTimes(3)
  })
})
