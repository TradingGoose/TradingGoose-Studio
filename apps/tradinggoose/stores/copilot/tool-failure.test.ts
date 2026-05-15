import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportClientManagedToolFailure } from '@/stores/copilot/tool-failure'

describe('client-managed tool failure reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the tool instance mark-complete method when available', async () => {
    const markToolComplete = vi.fn(async () => true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportClientManagedToolFailure({
      id: 'tool-1',
      name: 'plan',
      message: 'tool exploded',
      instance: {
        markToolComplete,
      },
    })

    expect(markToolComplete).toHaveBeenCalledWith(500, 'tool exploded')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the mark-complete endpoint when there is no tool instance', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await reportClientManagedToolFailure({
      id: 'tool-2',
      name: 'plan',
      message: 'Client-managed copilot tool instance not found',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/copilot/tools/mark-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tool-2',
        name: 'plan',
        status: 500,
        message: 'Client-managed copilot tool instance not found',
      }),
    })
  })
})
