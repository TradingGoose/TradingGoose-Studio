/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ shared: true, auth: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: m.auth }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/uploads/core/setup', () => ({
  getStorageProvider: () => 's3',
  UPLOAD_DIR: '/uploads',
  USE_S3_STORAGE: true,
  USE_AZURE_STORAGE: false,
  USE_LOCAL_STORAGE: false,
  USE_VERCEL_STORAGE: false,
}))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => ({
    bucket:
      context === 'copilot' || m.shared
        ? 'protected-source-bucket'
        : 'proved-disjoint-public-bucket',
    region: context === 'copilot' ? 'source-region' : 'other-region',
  }),
}))

import { GET } from './route'

async function image(url: string) {
  const request = new URL('https://studio.example/api/proxy/image')
  request.searchParams.set('url', url)
  return GET(new NextRequest(request))
}
function png() {
  return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
    headers: { 'Content-Type': 'image/png' },
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  m.shared = true
  m.auth.mockResolvedValue({ success: true, userId: 'actual-actor', authType: 'session' })
  m.fetch.mockImplementation(async () => png())
  vi.stubGlobal('fetch', m.fetch)
  vi.stubEnv('WORKFLOW_ARCHIVE_S3_BUCKET', 'archive-fixture')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('image proxy actual route private-source/redirect admission', () => {
  it.each([
    'https://protected-source-bucket.s3.us-west-2.amazonaws.com/flat.png',
    'https://s3.us-west-2.amazonaws.com/protected-source-bucket/flat.png',
    'https://studio.example/api/files/serve/s3/flat.png?context=general',
    'https://studio.example/api/files/serve/s3/flat.png?context=workspace',
    'https%3A%2F%2Fprotected-source-bucket.s3.us-east-1.amazonaws.com%2Fflat.png',
    'https://archive-fixture.s3.amazonaws.com/archive.json',
  ])('denies own/shared/encoded/archive source %s before any proxy fetch', async (url) => {
    const response = await image(url)
    expect(response.status).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('keeps ordinary public external image bytes and response behavior', async () => {
    const response = await image('https://public-images.example/image.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(8)
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://public-images.example/image.png',
      expect.objectContaining({ redirect: 'manual' })
    )
  })
  it('permits proved-disjoint general internal source while preserving actual URL validation', async () => {
    m.shared = false
    const response = await image(
      'https://studio.example/api/files/serve/s3/public/image.png?context=general'
    )
    expect(response.status).toBe(200)
    expect(m.fetch).toHaveBeenCalledOnce()
  })
  it.each([
    'https://protected-source-bucket.s3.us-west-2.amazonaws.com/flat.png',
    'https://s3.us-west-2.amazonaws.com/protected-source-bucket/flat.png',
    'https://studio.example/api/files/serve/s3/flat.png?context=general',
    'https://archive-fixture.s3.amazonaws.com/private.json',
  ])('rechecks redirect target %s and refuses before target byte retrieval', async (target) => {
    m.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: target } })
    )
    const response = await image('https://public-images.example/redirect')
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://public-images.example/redirect',
      expect.objectContaining({ redirect: 'manual' })
    )
    if (target.includes('archive-fixture')) expect(response.status).toBeGreaterThanOrEqual(400)
    else expect(response.status).toBe(403)
    expect(await response.text()).toMatch(/access|archive/i)
  })
  it('keeps an allowed public redirect functional while checking each hop', async () => {
    m.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://second-public.example/image.png' },
      })
    )
    expect((await image('https://public-images.example/redirect')).status).toBe(200)
    expect(m.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://public-images.example/redirect',
      'https://second-public.example/image.png',
    ])
    expect(m.fetch.mock.calls.every(([, options]) => options.redirect === 'manual')).toBe(true)
  })
  it('authentication and original private-network URL validation remain in force', async () => {
    m.auth.mockResolvedValueOnce({ success: false })
    expect((await image('https://public-images.example/image.png')).status).toBe(401)
    expect((await image('http://127.0.0.1/private.png')).status).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
  })
})
