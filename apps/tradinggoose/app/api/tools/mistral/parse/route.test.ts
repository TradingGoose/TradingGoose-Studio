/** @vitest-environment node */
import type { workspaceFile } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  shared: true,
  protectedKnowledgeBase: false,
  auth: vi.fn(),
  signer: vi.fn(),
  model: vi.fn(),
  access: vi.fn(),
}))
let workspaceRows: (typeof workspaceFile.$inferSelect)[] = []
let workspaceQueries: ReturnType<PgDialect['sqlToQuery']>[] = []
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          const query = new PgDialect().sqlToQuery(condition)
          workspaceQueries.push(query)
          return {
            limit: async () =>
              workspaceRows
                .filter((row) => row.id === query.params[0] && row.workspaceId === query.params[1])
                .slice(0, 1),
          }
        },
      }),
    }),
  },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.access }))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: vi.fn(),
  decrementStorageUsage: vi.fn(),
  incrementStorageUsage: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: m.auth }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/uploads', async () => ({
  StorageService: await import('@/lib/uploads/core/storage-service'),
  getServePathPrefix: () => '/api/files/serve/s3/',
}))
vi.mock('@/lib/uploads/providers/s3/s3-client', () => ({ getPresignedUrlWithConfig: m.signer }))
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
      context === 'copilot' ||
      m.shared ||
      (context === 'knowledge-base' && m.protectedKnowledgeBase)
        ? 'protected-source-bucket'
        : 'proved-disjoint-public-bucket',
    region: context === 'copilot' ? 'source-region' : 'different-requested-region',
  }),
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.example' }))

import { POST } from './route'

async function parse(filePath: string, extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest('https://studio.example/api/tools/mistral/parse', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'test-disposable-ocr-key', filePath, ...extra }),
    })
  )
}
function noContacts() {
  expect(m.signer).not.toHaveBeenCalled()
  expect(m.model).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  m.shared = true
  m.protectedKnowledgeBase = false
  workspaceRows = []
  workspaceQueries = []
  m.access.mockResolvedValue({ hasAccess: true })
  m.auth.mockResolvedValue({ success: true, userId: 'actual-actor', authType: 'session' })
  m.signer.mockResolvedValue('https://proved-public.example/new-authorized.pdf')
  m.model.mockImplementation(async () =>
    Response.json({ pages: [{ index: 0, markdown: 'Public document' }] })
  )
  vi.stubGlobal('fetch', m.model)
  vi.stubEnv('WORKFLOW_ARCHIVE_S3_BUCKET', 'archive-fixture')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('Mistral actual route private-source admission', () => {
  it.each([
    'flat-source.pdf',
    '/api/files/serve/s3/flat-source.pdf?context=general',
    '/api/files/serve/s3/flat-source.pdf?context=workspace',
    '/api/files/serve/s3/flat-source.pdf?context=knowledge-base',
    '/api/files/serve/s3/flat-source.pdf?context=execution',
    'https://studio.example/api/files/serve/s3/flat-source.pdf?context=general',
    'https://protected-source-bucket.s3.us-west-2.amazonaws.com/flat-source.pdf',
    'https://s3.us-west-2.amazonaws.com/protected-source-bucket/flat-source.pdf',
    'https%3A%2F%2Fprotected-source-bucket.s3.us-east-1.amazonaws.com%2Fflat-source.pdf',
    '%2Fapi%2Ffiles%2Fserve%2Fs3%2Fflat-source.pdf%3Fcontext%3Dgeneral',
  ])('shared bucket remains protected despite caller context/region/encoding %s', async (path) => {
    const response = await parse(path, {
      context: 'general',
      bucketName: 'untrusted-public-hint',
      userId: 'other-owner',
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('File access is unavailable'),
    })
    noContacts()
  })
  it('allows actual configured disjoint general internal source and sends only its newly signed URL to OCR', async () => {
    m.shared = false
    const response = await parse('/api/files/serve/s3/public/report.pdf?context=general', {
      pages: [0],
      includeImageBase64: false,
    })
    expect(response.status).toBe(200)
    expect(m.signer).toHaveBeenCalledExactlyOnceWith(
      'public/report.pdf',
      { bucket: 'proved-disjoint-public-bucket', region: 'different-requested-region' },
      300
    )
    expect(m.model).toHaveBeenCalledExactlyOnceWith(
      'https://api.mistral.ai/v1/ocr',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(m.model.mock.calls[0]![1].body)
    expect(body).toEqual({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        document_url: 'https://proved-public.example/new-authorized.pdf',
      },
      pages: [0],
      include_image_base64: false,
    })
  })
  it('retains public external OCR behavior without a private-storage signer', async () => {
    const response = await parse('https://public-documents.example/report.pdf')
    expect(response.status).toBe(200)
    expect(m.signer).not.toHaveBeenCalled()
    expect(JSON.parse(m.model.mock.calls[0]![1].body).document.document_url).toBe(
      'https://public-documents.example/report.pdf'
    )
  })
  it('archive source aliases and traversal stay closed before signer/model', async () => {
    for (const path of [
      'https://archive-fixture.s3.amazonaws.com/private.json',
      '/api/files/serve/archived-enhanced-logs/private.json',
      '/api/files/serve/s3/../copilot/source.png',
    ]) {
      const response = await parse(path)
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    noContacts()
  })
  it('authentication/schema failures never reach storage or OCR provider', async () => {
    m.auth.mockResolvedValueOnce({ success: false, error: 'Unauthorized' })
    expect((await parse('https://public-documents.example/report.pdf')).status).toBe(401)
    expect(
      (await parse('https://public-documents.example/report.pdf', { apiKey: '' })).status
    ).toBe(400)
    noContacts()
  })
  it('inferred actual knowledge-base destination rechecks before provider signer and returns actionable private-source refusal', async () => {
    m.shared = false
    m.protectedKnowledgeBase = true
    const response = await parse('/api/files/serve/s3/kb/original-source.pdf?context=general')
    noContacts()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('File access is unavailable'),
    })
    noContacts()
  })
  it('canonical workspace row plus fresh actual actor permission permits exact private destination signing without caller ownership', async () => {
    const row = {
      id: 'canonical-file',
      workspaceId: 'authorized-workspace',
      key: 'authorized-workspace/actual-canonical.pdf',
      name: 'Canonical.pdf',
      size: 32,
      type: 'application/pdf',
      uploadedBy: 'different-original-uploader',
      uploadedAt: new Date('2026-10-01T00:00:00Z'),
    }
    workspaceRows = [row]
    const reference = `/api/files/serve/s3/${encodeURIComponent(row.key)}?context=workspace&workspaceId=${row.workspaceId}&fileId=${row.id}`
    expect((await parse(reference)).status).toBe(200)
    expect(m.access).toHaveBeenCalledExactlyOnceWith(row.workspaceId, 'actual-actor')
    expect(workspaceQueries).toHaveLength(1)
    expect(workspaceQueries[0]!.params).toEqual([row.id, row.workspaceId])
    expect(workspaceQueries[0]!.sql).toContain('"workspace_file"."id"')
    expect(workspaceQueries[0]!.sql).toContain('"workspace_file"."workspace_id"')
    expect(m.signer).toHaveBeenCalledExactlyOnceWith(
      row.key,
      { bucket: 'protected-source-bucket', region: 'different-requested-region' },
      300
    )
    expect(m.model).toHaveBeenCalledOnce()
  })
  it('workspace membership revocation is freshly checked rather than reusing previous canonical read authority', async () => {
    workspaceRows = [
      {
        id: 'canonical-file',
        workspaceId: 'authorized-workspace',
        key: 'authorized-workspace/canonical.pdf',
        name: 'Canonical.pdf',
        size: 32,
        type: 'application/pdf',
        uploadedBy: 'uploader',
        uploadedAt: new Date(),
      },
    ]
    const reference = `/api/files/serve/s3/${encodeURIComponent(workspaceRows[0]!.key)}?context=workspace&workspaceId=authorized-workspace&fileId=canonical-file`
    expect((await parse(reference)).status).toBe(200)
    m.access.mockResolvedValueOnce({ hasAccess: false })
    expect((await parse(reference)).status).toBe(403)
    expect(m.access).toHaveBeenCalledTimes(2)
    expect(workspaceQueries).toHaveLength(1)
    expect(m.signer).toHaveBeenCalledOnce()
    expect(m.model).toHaveBeenCalledOnce()
  })
  it.each(['wrong-key', 'missing-row', 'wrong-workspace'])(
    'canonical locator %s cannot substitute actual row identity',
    async (kind) => {
      const row = {
        id: 'canonical-file',
        workspaceId: 'authorized-workspace',
        key: 'authorized-workspace/canonical.pdf',
        name: 'Canonical.pdf',
        size: 32,
        type: 'application/pdf',
        uploadedBy: 'uploader',
        uploadedAt: new Date(),
      }
      workspaceRows = kind === 'missing-row' ? [] : [row]
      const key = kind === 'wrong-key' ? 'authorized-workspace/private-other.pdf' : row.key
      const workspaceId = kind === 'wrong-workspace' ? 'other-workspace' : row.workspaceId
      expect(
        (
          await parse(
            `/api/files/serve/s3/${encodeURIComponent(key)}?context=workspace&workspaceId=${workspaceId}&fileId=${row.id}`
          )
        ).status
      ).toBe(403)
      expect(workspaceQueries[0]!.params).toEqual([row.id, workspaceId])
      noContacts()
    }
  )
  it('workspaceId alone and raw UserFile metadata never prove a protected source', async () => {
    expect(
      (
        await parse(
          '/api/files/serve/s3/flat-source.pdf?context=workspace&workspaceId=authorized-workspace',
          { file: { id: 'invented', key: 'flat-source.pdf', uploadedBy: 'actual-actor' } }
        )
      ).status
    ).toBe(403)
    expect(workspaceQueries).toHaveLength(0)
    expect(m.access).not.toHaveBeenCalled()
    noContacts()
  })
})
