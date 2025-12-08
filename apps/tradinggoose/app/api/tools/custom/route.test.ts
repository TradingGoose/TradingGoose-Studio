/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockUpsertCustomTools = vi.fn()

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/custom-tools/operations', () => ({
  upsertCustomTools: mockUpsertCustomTools,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  customTools: {},
  workflow: {},
}))

describe('Custom Tools API Routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-123' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockUpsertCustomTools.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET should return 401 when authentication fails', async () => {
    mockCheckHybridAuth.mockResolvedValue({ success: false })

    const req = new NextRequest('http://localhost:3000/api/tools/custom?workspaceId=ws-1')
    const { GET } = await import('@/app/api/tools/custom/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('GET should require workspaceId or workflowId', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom')
    const { GET } = await import('@/app/api/tools/custom/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('POST should require workspaceId in body', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom', {
      method: 'POST',
      body: JSON.stringify({
        tools: [
          {
            title: 'Example',
            schema: {
              type: 'function',
              function: {
                name: 'example',
                parameters: { type: 'object', properties: {} },
              },
            },
            code: '',
          },
        ],
      }),
    })

    const { POST } = await import('@/app/api/tools/custom/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('DELETE should require workspaceId query parameter', async () => {
    const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1', {
      method: 'DELETE',
    })

    const { DELETE } = await import('@/app/api/tools/custom/route')
    const res = await DELETE(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })
})
