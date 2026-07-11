/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import { readWatchlistItems, seedEntitySession } from '@/lib/yjs/entity-session'
import { useWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'

const fieldMocks = vi.hoisted(() => ({
  session: vi.fn(),
  setField: vi.fn(),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useSavedEntityYjsSession: (...args: unknown[]) => fieldMocks.session(...args),
  useYjsField: () => [DEFAULT_WATCHLIST_SETTINGS, fieldMocks.setField],
  useEntityList: () => ({ members: [], isLoading: false, error: null }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('useWatchlistYjsDocument access mode', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let current: ReturnType<typeof useWatchlistYjsDocument>

  const Harness = ({ accessMode }: { accessMode: ReviewAccessMode }) => {
    current = useWatchlistYjsDocument({
      workspaceId: 'workspace-1',
      watchlistId: 'watchlist-1',
      accessMode,
    })
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'watchlist',
      payload: {
        settings: DEFAULT_WATCHLIST_SETTINGS,
        items: [
          {
            id: 'item-1',
            type: 'listing',
            parentId: null,
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      },
    })
    fieldMocks.session.mockReturnValue({
      doc,
      save: vi.fn(async () => {}),
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    doc.destroy()
    container.remove()
  })

  it('blocks a retained item updater and does not expose raw mutation handles to readers', async () => {
    await act(async () => root.render(<Harness accessMode='write' />))
    const retainedUpdateItems = current.updateItems

    await act(async () => root.render(<Harness accessMode='read' />))
    act(() =>
      retainedUpdateItems((items) => [
        ...items,
        {
          id: 'item-2',
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
    )

    expect(readWatchlistItems(doc)).toHaveLength(1)
    expect(current).not.toHaveProperty('doc')
    expect(current).not.toHaveProperty('setSettings')
  })
})
