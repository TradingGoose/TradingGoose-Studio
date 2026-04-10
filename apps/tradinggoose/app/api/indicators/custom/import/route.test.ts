/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthenticateIndicatorRequest = vi.fn()
const mockCheckWorkspacePermission = vi.fn()
const mockImportIndicators = vi.fn()

vi.mock('@/app/api/indicators/utils', () => ({
  authenticateIndicatorRequest: mockAuthenticateIndicatorRequest,
  checkWorkspacePermission: mockCheckWorkspacePermission,
}))

vi.mock('@/lib/indicators/custom/operations', () => ({
  importIndicators: mockImportIndicators,
}))

describe('Indicators import route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuthenticateIndicatorRequest.mockResolvedValue({
      userId: 'user-123',
      authType: 'session',
    })
    mockCheckWorkspacePermission.mockResolvedValue({ ok: true, permission: 'admin' })
    mockImportIndicators.mockResolvedValue({
      indicators: [],
      importedCount: 0,
      renamedCount: 0,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('imports indicators and returns counts', async () => {
    mockImportIndicators.mockResolvedValue({
      indicators: [
        {
          id: 'indicator-1',
          workspaceId: 'ws-1',
          userId: 'user-123',
          name: 'RSI Export Example (imported) 1',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: {},
          createdAt: '2026-04-08T15:30:00.000Z',
          updatedAt: '2026-04-08T15:30:00.000Z',
        },
      ],
      importedCount: 1,
      renamedCount: 1,
    })

    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators'],
          skills: [],
          workflows: [],
          customTools: [],
          watchlists: [],
          indicators: [
            {
              name: 'RSI Export Example',
              color: '#3972F6',
              pineCode: "indicator('RSI Export Example')",
              inputMeta: {},
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockImportIndicators).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-123',
        indicators: [
          {
            name: 'RSI Export Example',
            color: '#3972F6',
            pineCode: "indicator('RSI Export Example')",
            inputMeta: {},
          },
        ],
      })
    )
    expect(body.import).toEqual({ addedCount: 1, renamedCount: 1 })
  })

  it('requires workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators'],
          indicators: [
            {
              name: 'RSI Export Example',
              pineCode: "indicator('RSI Export Example')",
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('requires write permission', async () => {
    mockCheckWorkspacePermission.mockResolvedValue({
      ok: false,
      code: 'write_permission_required',
      response: new Response(JSON.stringify({ error: 'Write permission required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators'],
          indicators: [
            {
              name: 'RSI Export Example',
              pineCode: "indicator('RSI Export Example')",
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Write permission required')
  })

  it('requires authentication', async () => {
    mockAuthenticateIndicatorRequest.mockResolvedValue({
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators'],
          indicators: [
            {
              name: 'RSI Export Example',
              pineCode: "indicator('RSI Export Example')",
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockImportIndicators).not.toHaveBeenCalled()
  })

  it('imports only the indicators section from mixed-resource files', async () => {
    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators', 'skills'],
          skills: [
            {
              name: 'Ignore me',
            },
          ],
          workflows: [],
          customTools: [],
          watchlists: [],
          indicators: [
            {
              name: 'RSI Export Example',
              pineCode: "indicator('RSI Export Example')",
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockImportIndicators).toHaveBeenCalledWith(
      expect.objectContaining({
        indicators: [
          {
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      })
    )
  })

  it('rejects invalid unified files before importing', async () => {
    const req = new NextRequest('http://localhost:3000/api/indicators/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'indicatorEditor',
          resourceTypes: ['indicators'],
          indicators: [
            {
              name: 'RSI Export Example',
              pineCode: "indicator('RSI Export Example')",
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/indicators/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid request data')
    expect(mockImportIndicators).not.toHaveBeenCalled()
  })
})
