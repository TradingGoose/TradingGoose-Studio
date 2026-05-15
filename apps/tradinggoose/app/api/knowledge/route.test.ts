/**
 * Tests for knowledge base API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, mockConsoleLogger } from '@/app/api/__test-utils__/utils'

mockConsoleLogger()

vi.mock('@/lib/knowledge/service', () => ({
  createKnowledgeBase: vi.fn(),
  getKnowledgeBases: vi.fn(),
}))

describe('Knowledge Base API Route', () => {
  const mockAuth$ = mockAuth()
  let mockCreateKnowledgeBase: any
  let mockGetKnowledgeBases: any

  beforeEach(async () => {
    vi.clearAllMocks()

    const knowledgeService = await import('@/lib/knowledge/service')
    mockCreateKnowledgeBase = knowledgeService.createKnowledgeBase as any
    mockGetKnowledgeBases = knowledgeService.getKnowledgeBases as any

    mockGetKnowledgeBases.mockResolvedValue([])
    mockCreateKnowledgeBase.mockImplementation(async (data: any) => {
      const now = new Date('2026-03-30T12:00:00.000Z')
      return {
        id: 'mock-uuid-1234-5678',
        name: data.name,
        description: data.description ?? null,
        tokenCount: 0,
        embeddingModel: data.embeddingModel,
        embeddingDimension: data.embeddingDimension,
        chunkingConfig: data.chunkingConfig,
        createdAt: now,
        updatedAt: now,
        workspaceId: data.workspaceId,
        docCount: 0,
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/knowledge', () => {
    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = new NextRequest('http://localhost:3000/api/knowledge?workspaceId=workspace-123')
      const { GET } = await import('@/app/api/knowledge/route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockGetKnowledgeBases.mockRejectedValueOnce(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/knowledge?workspaceId=workspace-123')
      const { GET } = await import('@/app/api/knowledge/route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch knowledge bases')
    })
  })

  describe('POST /api/knowledge', () => {
    const validKnowledgeBaseData = {
      name: 'Test Knowledge Base',
      description: 'Test description',
      workspaceId: 'workspace-123',
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      },
    }

    it('should create knowledge base successfully', async () => {
      mockAuth$.mockAuthenticatedUser()

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe(validKnowledgeBaseData.name)
      expect(data.data.description).toBe(validKnowledgeBaseData.description)
      expect(mockCreateKnowledgeBase).toHaveBeenCalledWith(
        expect.objectContaining({
          ...validKnowledgeBaseData,
          userId: 'user-123',
        }),
        expect.any(String)
      )
    })

    it('should return unauthorized for unauthenticated user', async () => {
      mockAuth$.mockUnauthenticated()

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate required fields', async () => {
      mockAuth$.mockAuthenticatedUser()

      const req = createMockRequest('POST', { description: 'Missing name' })
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should validate chunking config constraints', async () => {
      mockAuth$.mockAuthenticatedUser()

      const invalidData = {
        name: 'Test KB',
        workspaceId: 'workspace-123',
        chunkingConfig: {
          maxSize: 100,
          minSize: 200, // Invalid: minSize > maxSize
          overlap: 50,
        },
      }

      const req = createMockRequest('POST', invalidData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })

    it('should use default values for optional fields', async () => {
      mockAuth$.mockAuthenticatedUser()

      const minimalData = { name: 'Test KB', workspaceId: 'workspace-123' }
      const req = createMockRequest('POST', minimalData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.embeddingModel).toBe('text-embedding-3-small')
      expect(data.data.embeddingDimension).toBe(1536)
      expect(data.data.chunkingConfig).toEqual({
        maxSize: 1024,
        minSize: 1,
        overlap: 200,
      })
    })

    it('should handle database errors during creation', async () => {
      mockAuth$.mockAuthenticatedUser()
      mockCreateKnowledgeBase.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const { POST } = await import('@/app/api/knowledge/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create knowledge base')
    })
  })
})
