/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockImportSkills = vi.fn()

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/skills/operations', () => ({
  importSkills: mockImportSkills,
}))

describe('Skills import route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-123' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockImportSkills.mockResolvedValue({
      skills: [],
      importedSkills: [],
      importedCount: 0,
      renamedCount: 0,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('imports skills and returns counts', async () => {
    mockImportSkills.mockResolvedValue({
      skills: [
        {
          id: 'skill-1',
          workspaceId: 'ws-1',
          userId: 'user-123',
          name: 'Market Research (imported) 1',
          description: 'Investigate the market.',
          content: 'Use multiple trusted sources.',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      importedSkills: [
        {
          sourceName: 'Market Research',
          skillId: 'skill-1',
          name: 'Market Research (imported) 1',
        },
      ],
      importedCount: 1,
      renamedCount: 1,
    })

    const req = new NextRequest('http://localhost:3000/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/skills/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockImportSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-123',
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Use multiple trusted sources.',
          },
        ],
      })
    )
    expect(body.import).toEqual({ addedCount: 1, renamedCount: 1 })
    expect(body.importedSkills).toEqual([
      {
        sourceName: 'Market Research',
        skillId: 'skill-1',
        name: 'Market Research (imported) 1',
      },
    ])
  })

  it('requires workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/skills/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('workspaceId is required')
  })

  it('requires write permission', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const req = new NextRequest('http://localhost:3000/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/skills/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Write permission required')
  })

  it('imports only the skills section from mixed-resource files', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills', 'workflows'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
          workflows: [
            {
              name: 'Example workflow',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/skills/import/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockImportSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-123',
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Use multiple trusted sources.',
          },
        ],
      })
    )
  })

  it('rejects import files with extra keys', async () => {
    const req = new NextRequest('http://localhost:3000/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'ws-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              id: 'skill-1',
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        },
      }),
    })

    const { POST } = await import('@/app/api/skills/import/route')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid request data')
  })
})
