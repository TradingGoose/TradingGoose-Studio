/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockImportCustomTools = vi.fn()

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/custom-tools/operations', () => ({
  importCustomTools: mockImportCustomTools,
}))

describe('Custom tools import route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-123' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockImportCustomTools.mockResolvedValue({
      tools: [],
      importedCount: 0,
      renamedCount: 0,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('imports custom tools and returns counts', async () => {
    mockImportCustomTools.mockResolvedValue({
      tools: [
        {
          id: 'tool-1',
          workspaceId: 'ws-1',
          userId: 'user-123',
          title: 'My Tool (imported) 1',
          schema: {
            type: 'function',
            function: {
              name: 'myTool_imported_1',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: 'return { ok: true }',
          createdAt: '2026-04-08T15:30:00.000Z',
          updatedAt: '2026-04-08T15:30:00.000Z',
        },
      ],
      importedCount: 1,
      renamedCount: 1,
    })

    const req = new NextRequest('http://localhost:3000/api/tools/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'customToolEditor',
          resourceTypes: ['customTools'],
          skills: [],
          workflows: [],
          customTools: [
            {
              title: 'My Tool',
              schema: {
                type: 'function',
                function: {
                  name: 'myTool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
              code: 'return { ok: true }',
            },
          ],
          watchlists: [],
          indicators: [],
        },
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockImportCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-123',
        tools: [
          {
            title: 'My Tool',
            schema: {
              type: 'function',
              function: {
                name: 'myTool',
                parameters: {
                  type: 'object',
                  properties: {},
                },
              },
            },
            code: 'return { ok: true }',
          },
        ],
      })
    )
    expect(body.import).toEqual({ addedCount: 1, renamedCount: 1 })
  })

  it('requires workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'customToolEditor',
          resourceTypes: ['customTools'],
          customTools: [
            {
              title: 'My Tool',
              schema: {
                type: 'function',
                function: {
                  name: 'myTool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
              code: 'return { ok: true }',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('requires write permission', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const req = new NextRequest('http://localhost:3000/api/tools/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'customToolEditor',
          resourceTypes: ['customTools'],
          customTools: [
            {
              title: 'My Tool',
              schema: {
                type: 'function',
                function: {
                  name: 'myTool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
              code: 'return { ok: true }',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Write permission required')
  })

  it('imports only the customTools section from mixed-resource files', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'customToolEditor',
          resourceTypes: ['customTools', 'skills'],
          skills: [
            {
              name: 'Ignore me',
            },
          ],
          workflows: [],
          customTools: [
            {
              title: 'My Tool',
              schema: {
                type: 'function',
                function: {
                  name: 'myTool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
              code: 'return { ok: true }',
            },
          ],
          watchlists: [],
          indicators: [],
        },
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/import/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockImportCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-123',
        tools: [
          expect.objectContaining({
            title: 'My Tool',
            code: 'return { ok: true }',
          }),
        ],
      })
    )
  })

  it('rejects import files with extra keys on custom tool entries', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-08T15:30:00.000Z',
          exportedFrom: 'customToolEditor',
          resourceTypes: ['customTools'],
          customTools: [
            {
              id: 'tool-1',
              title: 'My Tool',
              schema: {
                type: 'function',
                function: {
                  name: 'myTool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
              code: 'return { ok: true }',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid request data')
  })
})
