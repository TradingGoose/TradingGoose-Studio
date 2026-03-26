/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockUpsertSkills = vi.fn()
const mockListSkills = vi.fn()
const mockDeleteSkill = vi.fn()

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/skills/operations', () => ({
  upsertSkills: mockUpsertSkills,
  listSkills: mockListSkills,
  deleteSkill: mockDeleteSkill,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'skill-1' }]),
        }),
      }),
    }),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  skill: {},
}))

describe('Skills API Routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-123' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockUpsertSkills.mockResolvedValue([])
    mockListSkills.mockResolvedValue([])
    mockDeleteSkill.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET should return 401 when authentication fails', async () => {
    mockCheckHybridAuth.mockResolvedValue({ success: false })

    const req = new NextRequest('http://localhost:3000/api/skills?workspaceId=ws-1')
    const { GET } = await import('@/app/api/skills/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('GET should require workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills')
    const { GET } = await import('@/app/api/skills/route')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('POST should require workspaceId in body', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills', {
      method: 'POST',
      body: JSON.stringify({
        skills: [
          {
            name: 'example-skill',
            description: 'Example',
            content: 'Example content',
          },
        ],
      }),
    })

    const { POST } = await import('@/app/api/skills/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('DELETE should require workspaceId query parameter', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills?id=skill-1', {
      method: 'DELETE',
    })

    const { DELETE } = await import('@/app/api/skills/route')
    const res = await DELETE(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })
})
