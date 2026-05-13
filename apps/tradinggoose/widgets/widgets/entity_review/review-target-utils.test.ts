import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEntityReviewTarget } from './review-target-utils'

describe('review target utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves editable entity targets with write access', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await resolveEntityReviewTarget({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-1',
    })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).accessMode).toBe('write')
  })
})
