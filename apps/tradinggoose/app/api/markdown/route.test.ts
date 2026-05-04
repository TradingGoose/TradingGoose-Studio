/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRenderPublicPageMarkdown = vi.fn()
const mockGetAccurateTokenCount = vi.fn()

vi.mock('@/lib/markdown/public-page-markdown', () => ({
  renderPublicPageMarkdown: mockRenderPublicPageMarkdown,
}))

vi.mock('@/lib/tokenization/estimators', () => ({
  getAccurateTokenCount: mockGetAccurateTokenCount,
}))

function createRequest(path: string, method: 'GET' | 'HEAD') {
  return new NextRequest(`http://localhost:3000/api/markdown?path=${encodeURIComponent(path)}`, {
    method,
  })
}

describe('/api/markdown route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockRenderPublicPageMarkdown.mockResolvedValue('markdown body')
    mockGetAccurateTokenCount.mockReturnValue(2)
  })

  it.each(['/es', '/zh'] as const)(
    'appends discovery links for GET homepage requests at %s',
    async (path) => {
      const { GET } = await import('./route')
      const response = await GET(createRequest(path, 'GET'))

      expect(response.status).toBe(200)
      expect(mockRenderPublicPageMarkdown).toHaveBeenCalledWith('http://localhost:3000', path)

      const linkHeader = response.headers.get('Link') ?? ''
      expect(linkHeader).toContain('rel="api-catalog"')
      expect(linkHeader).toContain('rel="service-doc"')
      expect(linkHeader).toContain('rel="describedby"')
    }
  )

  it.each(['/es', '/zh'] as const)(
    'appends discovery links for HEAD homepage requests at %s',
    async (path) => {
      const { HEAD } = await import('./route')
      const response = await HEAD(createRequest(path, 'HEAD'))

      expect(response.status).toBe(200)
      expect(mockRenderPublicPageMarkdown).toHaveBeenCalledWith('http://localhost:3000', path)

      const linkHeader = response.headers.get('Link') ?? ''
      expect(linkHeader).toContain('rel="api-catalog"')
      expect(linkHeader).toContain('rel="service-doc"')
      expect(linkHeader).toContain('rel="describedby"')
    }
  )
})
