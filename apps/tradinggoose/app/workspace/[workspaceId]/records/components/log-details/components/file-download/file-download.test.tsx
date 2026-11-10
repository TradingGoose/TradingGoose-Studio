/** @vitest-environment jsdom */

import { act } from 'react'
import type { workspaceFile } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserFile } from '@/executor/types'
import { FileDownload } from './file-download'

const m = vi.hoisted(() => ({
  shared: true,
  signer: vi.fn(),
  fetch: vi.fn(),
  auth: vi.fn(),
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
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: m.auth }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.access }))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: vi.fn(),
  decrementStorageUsage: vi.fn(),
  incrementStorageUsage: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/s3/' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'test-records-source-key' } }))
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
    region: 'fixture-region',
  }),
}))
vi.mock('@/lib/uploads/providers/s3/s3-client', () => ({ getPresignedUrlWithConfig: m.signer }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.test' }))
const file: UserFile = {
  id: 'output-file',
  name: 'report.txt',
  size: 32,
  type: 'text/plain',
  key: 'retained-flat-key.txt',
  url: 'https://unverified-output.example/old-url',
  uploadedAt: '2026-11-08T00:00:00.000Z',
  expiresAt: '2026-11-09T00:00:00.000Z',
  context: 'execution',
}
let container: HTMLDivElement
let root: Root
let statuses: number[]
beforeEach(async () => {
  vi.resetAllMocks()
  m.shared = true
  workspaceRows = []
  workspaceQueries = []
  m.auth.mockResolvedValue({ success: true, userId: 'actual-actor', authType: 'session' })
  m.access.mockResolvedValue({ hasAccess: true })
  statuses = []
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
    writable: true,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { POST } = await import('@/app/api/files/download/route')
  m.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/files/download')
    const response = await POST(
      new NextRequest('https://studio.test/api/files/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: String(init.body),
      })
    )
    statuses.push(response.status)
    return response
  })
  m.signer.mockResolvedValue('https://proved-disjoint-public.example/authorized-download')
  vi.stubGlobal('fetch', m.fetch)
  vi.spyOn(window, 'open').mockImplementation(() => null)
  await act(async () => root.render(<FileDownload file={file} isExecutionFile />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function click() {
  await act(async () => {
    container.querySelector('button')!.click()
  })
}
describe('Records actual file-download button/route boundary', () => {
  it('actual shared-destination route refusal displays actionable access error before signer/window and never trusts raw UserFile', async () => {
    await click()
    expect(statuses).toEqual([403])
    expect(m.signer).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'File access is unavailable'
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Request a new authorized download'
    )
    expect(JSON.parse(m.fetch.mock.calls[0]![1].body)).toEqual({
      key: file.key,
      fileReference: file.url,
      name: file.name,
      isExecutionFile: true,
    })
    expect(container.querySelector('button')?.disabled).toBe(false)
  })
  it('proved-disjoint configured public destination keeps allowed fresh signing/download behavior', async () => {
    m.shared = false
    await click()
    expect(statuses).toEqual([200])
    expect(m.signer).toHaveBeenCalledExactlyOnceWith(
      file.key,
      { bucket: 'proved-disjoint-public-bucket', region: 'fixture-region' },
      300
    )
    expect(window.open).toHaveBeenCalledExactlyOnceWith(
      'https://proved-disjoint-public.example/authorized-download',
      '_blank'
    )
    expect(window.open).not.toHaveBeenCalledWith(file.url, expect.anything())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('a later allowed user attempt clears the actual refusal and uses only its newly authorized URL', async () => {
    await click()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    m.shared = false
    await click()
    expect(statuses).toEqual([403, 200])
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(window.open).toHaveBeenCalledOnce()
  })
  it('missing fresh download URL and request failure remain visible without opening stored output URL', async () => {
    m.shared = false
    m.signer.mockResolvedValueOnce(undefined)
    await click()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'authorized download is unavailable'
    )
    expect(window.open).not.toHaveBeenCalled()
    m.fetch.mockRejectedValueOnce(new Error('Download service unavailable'))
    await click()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Download service unavailable'
    )
    expect(window.open).not.toHaveBeenCalled()
  })
  it('stored URL is only a locator: actual canonical row and fresh actor permission permit exact private workspace download', async () => {
    const row = {
      id: 'canonical-file',
      workspaceId: 'authorized-workspace',
      key: 'authorized-workspace/canonical.pdf',
      name: 'Canonical.pdf',
      size: 32,
      type: 'application/pdf',
      uploadedBy: 'different-uploader',
      uploadedAt: new Date(),
    }
    workspaceRows = [row]
    const url = `/api/files/serve/s3/${encodeURIComponent(row.key)}?context=workspace&workspaceId=${row.workspaceId}&fileId=${row.id}`
    await act(async () =>
      root.render(<FileDownload file={{ ...file, key: row.key, url }} isExecutionFile />)
    )
    await click()
    expect(statuses).toEqual([200])
    expect(m.access).toHaveBeenCalledExactlyOnceWith(row.workspaceId, 'actual-actor')
    expect(workspaceQueries[0]!.params).toEqual([row.id, row.workspaceId])
    expect(m.signer).toHaveBeenCalledExactlyOnceWith(
      row.key,
      { bucket: 'protected-source-bucket', region: 'fixture-region' },
      300
    )
    expect(window.open).toHaveBeenCalledExactlyOnceWith(
      'https://proved-disjoint-public.example/authorized-download',
      '_blank'
    )
    expect(window.open).not.toHaveBeenCalledWith(url, expect.anything())
  })
  it('revoked permission never reuses the previous canonical URL or retained read capability', async () => {
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
    workspaceRows = [row]
    const url = `/api/files/serve/s3/${encodeURIComponent(row.key)}?context=workspace&workspaceId=${row.workspaceId}&fileId=${row.id}`
    await act(async () =>
      root.render(<FileDownload file={{ ...file, key: row.key, url }} isExecutionFile />)
    )
    await click()
    m.access.mockResolvedValueOnce({ hasAccess: false })
    await click()
    expect(statuses).toEqual([200, 403])
    expect(m.signer).toHaveBeenCalledOnce()
    expect(window.open).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'File access is unavailable'
    )
  })
  it.each(['wrong-body-key', 'wrong-reference-key', 'missing-row'])(
    'canonical locator %s never authorizes a different stored key',
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
      const referenceKey =
        kind === 'wrong-reference-key' ? 'authorized-workspace/other.pdf' : row.key
      const url = `/api/files/serve/s3/${encodeURIComponent(referenceKey)}?context=workspace&workspaceId=${row.workspaceId}&fileId=${row.id}`
      await act(async () =>
        root.render(
          <FileDownload
            file={{
              ...file,
              key: kind === 'wrong-body-key' ? 'authorized-workspace/wrong-body.pdf' : row.key,
              url,
            }}
            isExecutionFile
          />
        )
      )
      await click()
      expect(statuses).toEqual([403])
      expect(m.signer).not.toHaveBeenCalled()
      expect(window.open).not.toHaveBeenCalled()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'File access is unavailable'
      )
    }
  )
})
