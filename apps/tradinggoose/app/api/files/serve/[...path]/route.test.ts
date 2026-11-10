/** @vitest-environment node */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  provider: 's3',
  actor: 'owner' as string | null,
  permitted: true,
  file: {
    id: 'file-1',
    workspaceId: 'workspace-1',
    key: 'workspace-1/owned.txt',
    type: 'text/plain',
    name: 'owned.txt',
  } as Record<string, string> | null,
  configs: {} as Record<string, Record<string, string>>,
  read: vi.fn(),
  sign: vi.fn(),
  access: vi.fn(),
  getFile: vi.fn(),
  hybrid: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: { INTERNAL_API_SECRET: 'synthetic-completed-source-signing-secret' },
}))
vi.mock('@/lib/auth', () => ({
  getSession: async () => (state.actor ? { user: { id: state.actor } } : null),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: state.hybrid }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ getWorkspaceFile: state.getFile }))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => state.configs[context] ?? state.configs.general,
}))
vi.mock('@/lib/uploads/core/setup', () => ({
  getStorageProvider: () => state.provider,
  get USE_S3_STORAGE() {
    return state.provider === 's3'
  },
  get USE_AZURE_STORAGE() {
    return state.provider === 'azure'
  },
  get USE_VERCEL_STORAGE() {
    return state.provider === 'vercel'
  },
  get USE_LOCAL_STORAGE() {
    return state.provider === 'local'
  },
  UPLOAD_DIR: '/uploads',
}))
vi.mock('@/lib/uploads', async () => ({
  isUsingCloudStorage: () => state.provider !== 'local',
  StorageService: await import('@/lib/uploads/core/storage-service'),
}))
vi.mock('@/lib/uploads/providers/s3/s3-client', () => ({
  downloadFromS3: state.read,
  getPresignedUrlWithConfig: state.sign,
}))
vi.mock('@/lib/uploads/providers/azure/azure-client', () => ({
  downloadFromAzure: state.read,
  getPresignedUrlWithConfig: state.sign,
}))
vi.mock('@/lib/uploads/providers/vercel/vercel-client', () => ({
  downloadFromVercel: state.read,
  getDownloadUrlWithConfig: state.sign,
}))
vi.mock('@/lib/uploads/providers/vercel/download-token', () => ({
  verifyVercelDownloadToken: async () => ({ key: 'old-flat.png', context: 'general' }),
}))

import { signCopilotSource } from '@/lib/uploads/contexts/copilot/source-proof'
import { POST as workspaceDownload } from '@/app/api/workspaces/[id]/files/[fileId]/download/route'
import { GET } from './route'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=',
  'base64'
)
beforeEach(() => {
  vi.resetAllMocks()
  state.provider = 's3'
  state.actor = 'owner'
  state.permitted = true
  state.file = {
    id: 'file-1',
    workspaceId: 'workspace-1',
    key: 'workspace-1/owned.txt',
    type: 'text/plain',
    name: 'owned.txt',
  }
  state.configs = {
    copilot: { bucket: 'shared-private', region: 'region-a' },
    general: { bucket: 'shared-private', region: 'region-b' },
    workspace: { bucket: 'shared-private', region: 'region-c' },
    execution: { bucket: 'disjoint-public', region: 'region-a' },
  }
  state.access.mockImplementation(async () => ({ hasAccess: state.permitted }))
  state.getFile.mockImplementation(async () => state.file)
  state.hybrid.mockImplementation(async () => ({
    success: Boolean(state.actor),
    userId: state.actor,
  }))
  state.read.mockResolvedValue(Buffer.from('owned text'))
  state.sign.mockResolvedValue('https://disjoint.example/download?signature=fixture')
})
afterEach(() => vi.useRealTimers())
async function serve(key: string, query: Record<string, string> = {}, prefix = 's3/') {
  const req = new NextRequest(
    `https://studio.example/api/files/serve/${prefix}${encodeURIComponent(key)}?${new URLSearchParams(query)}`
  )
  return GET(req, {
    params: Promise.resolve({ path: [...prefix.split('/').filter(Boolean), key] }),
  })
}
async function proof(key = 'copilot/owned.png') {
  return (
    await signCopilotSource({
      actorUserId: 'owner',
      key,
      filename: 'image.png',
      mediaType: 'image/png',
      size: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    })
  ).sourceProof
}

describe('actual private-source file delivery routes', () => {
  it.each(['general', 'workspace', 'chat'])(
    'refuses unproved shared cloud context %s before provider read',
    async (context) => {
      const response = await serve('old-flat.png', { context })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining('File access is unavailable'),
      })
      expect(state.read).not.toHaveBeenCalled()
    }
  )
  it('refuses local flat references even for an authenticated actor', async () => {
    state.provider = 'local'
    expect((await serve('old-flat.png', { context: 'general' }, '')).status).toBe(403)
    expect(state.read).not.toHaveBeenCalled()
  })
  it('does not treat old generic Vercel download tokens as source ownership', async () => {
    state.provider = 'vercel'
    expect(
      (await serve('old-flat.png', { downloadToken: 'old-generic-token' }, 'vercel/')).status
    ).toBe(403)
    expect(state.read).not.toHaveBeenCalled()
  })
  it('retains proved-disjoint generic cloud delivery and functional MIME output', async () => {
    const response = await serve('run/output.txt', { context: 'execution' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('owned text')
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(state.read).toHaveBeenCalledWith(
      'run/output.txt',
      expect.objectContaining({ bucket: 'disjoint-public' }),
      undefined
    )
  })
  it.each([null, 'workspace-1'])(
    'delivers owned current image with proof and real conversation scope %s',
    async (workspaceId) => {
      state.read.mockResolvedValue(png)
      const response = await serve('copilot/owned.png', {
        context: 'copilot',
        sourceProof: await proof(),
        ...(workspaceId ? { workspaceId } : {}),
      })
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(state.read).toHaveBeenCalledOnce()
      if (workspaceId) expect(state.access).toHaveBeenCalledWith(workspaceId, 'owner')
    }
  )
  it.each(['missing', 'cross-user', 'expired', 'revoked', 'unauthenticated'])(
    'refuses %s proof/scope before storage',
    async (kind) => {
      let sourceProof = await proof()
      if (kind === 'missing') sourceProof = ''
      if (kind === 'cross-user') state.actor = 'another-user'
      if (kind === 'unauthenticated') state.actor = null
      if (kind === 'revoked') state.permitted = false
      if (kind === 'expired') {
        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + 3601000)
      }
      const response = await serve('copilot/owned.png', {
        context: 'copilot',
        sourceProof,
        workspaceId: 'workspace-1',
      })
      expect([401, 403]).toContain(response.status)
      expect(state.read).not.toHaveBeenCalled()
    }
  )
  it.each(['missing', 'changed', 'provider-error'])(
    'fails %s delivery actionably without a partial image',
    async (kind) => {
      if (kind === 'provider-error')
        state.read.mockRejectedValue(new Error('synthetic storage failure'))
      else
        state.read.mockResolvedValue(
          kind === 'missing' ? Buffer.alloc(0) : Buffer.from('changed bytes')
        )
      const response = await serve('copilot/owned.png', {
        context: 'copilot',
        sourceProof: await proof(),
      })
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/upload the image again/),
      })
    }
  )
  it('uses actual canonical workspace permission and row before exact shared-store delivery', async () => {
    const response = await serve('workspace-1/owned.txt', {
      context: 'workspace',
      workspaceId: 'workspace-1',
      fileId: 'file-1',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('owned text')
    expect(state.access).toHaveBeenCalledWith('workspace-1', 'owner')
    expect(state.getFile).toHaveBeenCalledWith('workspace-1', 'file-1')
    expect(state.read).toHaveBeenCalledOnce()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each(['revoked', 'wrong-key', 'missing-row', 'unauthenticated'])(
    'refuses canonical workspace %s before provider read',
    async (kind) => {
      if (kind === 'revoked') state.permitted = false
      if (kind === 'wrong-key' && state.file) state.file.key = 'different.png'
      if (kind === 'missing-row') state.file = null
      if (kind === 'unauthenticated') state.actor = null
      const response = await serve('workspace-1/owned.txt', {
        context: 'workspace',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
      })
      expect([401, 403, 404]).toContain(response.status)
      expect(state.read).not.toHaveBeenCalled()
      if (kind === 'revoked' || kind === 'unauthenticated')
        expect(state.getFile).not.toHaveBeenCalled()
    }
  )
  it('retains actual canonical workspace download signing after authorization', async () => {
    const response = await workspaceDownload(
      new NextRequest('https://studio.example/api/workspaces/workspace-1/files/file-1/download', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'workspace-1', fileId: 'file-1' }) }
    )
    expect(response.status).toBe(200)
    expect(state.sign).toHaveBeenCalledWith(
      'workspace-1/owned.txt',
      expect.objectContaining({ bucket: 'shared-private' }),
      300
    )
    expect(await response.json()).toMatchObject({
      downloadUrl: 'https://disjoint.example/download?signature=fixture',
    })
  })
  it('keeps native Vercel/local workspace serve URLs bound to the canonical row with fresh auth', async () => {
    state.sign.mockResolvedValue(
      'https://studio.example/api/files/serve/vercel/workspace-1%2Fowned.txt?downloadToken=fixture'
    )
    const response = await workspaceDownload(
      new NextRequest('https://studio.example/api/workspaces/workspace-1/files/file-1/download', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'workspace-1', fileId: 'file-1' }) }
    )
    const url = new URL((await response.json()).downloadUrl)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      context: 'workspace',
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      downloadToken: 'fixture',
    })
  })
  it('refuses workspace signing after revocation and never contacts signer', async () => {
    state.permitted = false
    const response = await workspaceDownload(
      new NextRequest('https://studio.example/api/workspaces/workspace-1/files/file-1/download', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'workspace-1', fileId: 'file-1' }) }
    )
    expect(response.status).toBe(403)
    expect(state.sign).not.toHaveBeenCalled()
  })
  it('retains archive exclusion even for an actual canonical row', async () => {
    if (state.file) state.file.key = 'archived-enhanced-logs/private'
    const response = await serve('archived-enhanced-logs/private', {
      context: 'workspace',
      workspaceId: 'workspace-1',
      fileId: 'file-1',
    })
    expect(response.status).toBe(403)
    expect(state.read).not.toHaveBeenCalled()
  })
})
