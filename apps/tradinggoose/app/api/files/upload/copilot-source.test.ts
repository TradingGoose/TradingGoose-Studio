/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  actor: 'trusted-owner' as string | null,
  write: vi.fn(),
  read: vi.fn(),
  bytes: Buffer.alloc(0),
}))
vi.mock('@/lib/auth', () => ({
  getSession: async () => (state.actor ? { user: { id: state.actor } } : null),
}))
vi.mock('@/lib/env', () => ({
  env: { INTERNAL_API_SECRET: 'synthetic-upload-completion-only-secret' },
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({ UPLOAD_DIR_SERVER: '/disposable/uploads' }))
vi.mock('@/lib/uploads/core/setup', () => ({
  getStorageProvider: () => 's3',
  UPLOAD_DIR: '/uploads',
}))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: () => ({ bucket: 'shared-private', region: 'test' }),
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/workflows/utils', () => ({
  readWorkflowAccessContext: vi.fn(),
  hasWorkflowWriteAccess: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: () => true,
  uploadFile: state.write,
  downloadFile: state.read,
}))

import { verifyCopilotSource } from '@/lib/uploads/contexts/copilot/source-proof'
import { assertStorageReadAccess } from '@/lib/uploads/source-read-boundary'
import { POST } from './route'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=',
  'base64'
)
beforeEach(() => {
  vi.resetAllMocks()
  state.actor = 'trusted-owner'
  state.bytes = png
  state.write.mockImplementation(async (input) => ({
    key: input.customKey,
    path: `/api/files/serve/s3/${encodeURIComponent(input.customKey)}`,
    name: input.fileName,
    type: input.contentType,
    size: input.file.length,
  }))
  state.read.mockImplementation(async ({ key, context }) => {
    assertStorageReadAccess(key, context)
    return state.bytes
  })
})
function request(
  files = [new File([png], 'owned.png', { type: 'image/png' })],
  fields: Record<string, string> = {}
) {
  const data = new FormData()
  for (const file of files) data.append('file', file)
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return new NextRequest('https://studio.example/api/files/upload?type=copilot', {
    method: 'POST',
    body: data,
  })
}
describe('actual authenticated Copilot upload completion', () => {
  it('returns a source proof only after trusted actor allocation, immutable write and exact readback', async () => {
    const response = await POST(request(undefined, { userId: 'caller-injected-owner' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    const file = body.files?.[0] ?? body.file ?? body
    expect(file.sourceProof).toEqual(expect.any(String))
    expect(await verifyCopilotSource(file.sourceProof)).toMatchObject({
      actorUserId: 'trusted-owner',
      key: file.key,
      context: 'copilot',
      size: png.length,
      mediaType: 'image/png',
    })
    expect(state.write).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'copilot',
        preventOverwrite: true,
        preserveKey: true,
        customKey: expect.stringMatching(/^copilot\//),
      })
    )
    expect(state.read).toHaveBeenCalledOnce()
  })
  it('refuses unauthenticated uploads before any allocation/read', async () => {
    state.actor = null
    expect((await POST(request())).status).toBe(401)
    expect(state.write).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
  it.each<Record<string, string>>([
    { workspaceId: 'other-workspace' },
    { workflowId: 'workflow', executionId: 'execution', workspaceId: 'workspace' },
    { knowledgeBaseId: 'kb' },
  ])('refuses storage context overrides before allocation %j', async (fields) => {
    expect((await POST(request(undefined, fields))).status).toBe(400)
    expect(state.write).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
  it('validates all upload descriptors before writing a mixed batch', async () => {
    const response = await POST(
      request([
        new File([png], 'owned.png', { type: 'image/png' }),
        new File(['not-image'], 'wrong.txt', { type: 'text/plain' }),
      ])
    )
    expect(response.status).toBe(400)
    expect(state.write).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
  it('refuses disguised media before storage allocation', async () => {
    const response = await POST(
      request([new File(['not-image'], 'wrong.png', { type: 'image/png' })])
    )
    expect(response.status).toBe(415)
    expect(state.write).not.toHaveBeenCalled()
    expect(state.read).not.toHaveBeenCalled()
  })
  it('does not issue an ownership proof after failed exact stored-byte readback', async () => {
    state.bytes = Buffer.from('changed')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('sourceProof')
    expect(state.write).toHaveBeenCalledOnce()
    expect(state.read).toHaveBeenCalledOnce()
  })
})
