import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCopilotEntityReviewTarget } from './review-target-utils'

describe('copilot review target utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves current entity targets with read access by default', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await resolveCopilotEntityReviewTarget({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-1',
    })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).accessMode).toBe('read')
  })

  it('uses explicit write access for mutation resolution', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await resolveCopilotEntityReviewTarget({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      accessMode: 'write',
    })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).accessMode).toBe('write')
  })
})
