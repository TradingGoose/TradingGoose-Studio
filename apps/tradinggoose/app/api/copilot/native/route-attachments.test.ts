/** @vitest-environment node */
import { createHash, createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_NATIVE_REVISION } from '@/lib/copilot/native/contract'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  download: vi.fn(),
  model: vi.fn(),
  contexts: vi.fn(),
  manifest: vi.fn(),
  bucket: 'copilot-fixture',
}))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.access }))
vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'test-source-ingress-pepper' } }))
vi.mock('@/lib/uploads/core/setup', () => ({ getStorageProvider: () => 's3' }))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: () => ({ bucket: m.bucket, region: 'us-east-1' }),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: m.download,
  uploadFile: vi.fn(),
}))
vi.mock('@/lib/copilot/native/client', () => ({
  fetchNativeCopilot: m.model,
  readNativeCopilot: vi.fn(),
}))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: vi.fn() }))
vi.mock('@/lib/copilot/runtime-models', () => ({ COPILOT_RUNTIME_MODELS: ['test/model'] }))
vi.mock('@/lib/copilot/runtime-tool-manifest', () => ({
  getCopilotRuntimeToolManifest: m.manifest,
}))
vi.mock('@/lib/copilot/process-contents', () => ({ processContextsServer: m.contexts }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: vi.fn() }))
vi.mock('@/lib/copilot/native/business-access', () => ({ authorizeNativeBusinessResult: vi.fn() }))

import { signCopilotSource } from '@/lib/uploads/contexts/copilot/source-proof'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=',
  'base64'
)
async function source(
  actor = 'actual-actor',
  key = 'copilot/source.png',
  bytes = png,
  mediaType = 'image/png'
) {
  return {
    key,
    filename: 'image.png',
    media_type: mediaType,
    size: bytes.length,
    ...(await signCopilotSource({
      actorUserId: actor,
      key,
      filename: 'image.png',
      mediaType,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  }
}
async function post(
  attachments: unknown[],
  workspaceId: string | null = null,
  signal?: AbortSignal
) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.test/api/copilot/native', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        requestId: 'attachment-request',
        command: 'message',
        workspaceId,
        model: 'test/model',
        stream: false,
        input: { content: 'Describe image', contexts: [] },
        fileAttachments: attachments.map((value) => {
          if (!value || typeof value !== 'object') return value
          return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'expiresAt'))
        }),
      }),
    })
  )
}
function noContacts() {
  expect(m.download).not.toHaveBeenCalled()
  expect(m.model).not.toHaveBeenCalled()
  expect(m.contexts).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.clearAllMocks()
  m.bucket = 'copilot-fixture'
  m.session.mockResolvedValue({ user: { id: 'actual-actor' } })
  m.access.mockResolvedValue({ hasAccess: true })
  m.download.mockResolvedValue(png)
  m.contexts.mockResolvedValue([])
  m.manifest.mockResolvedValue({ version: 'v1', tools: [] })
  m.model.mockResolvedValue(
    Response.json({
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId: 'attachment-request',
      status: 'completed',
      runId: 'run',
      threadId: 'thread',
      text: 'Image received',
      financial: { accepted: true, modelUsd: 'unavailable', appliedUsd: '0.025' },
    })
  )
})
afterEach(() => vi.useRealTimers())
describe('actual native adapter signed image admission', () => {
  it('authorizes real personal source, verifies original bytes and emits only selected native image content', async () => {
    const response = await post([await source()])
    expect(response.status).toBe(200)
    expect((await response.json()).financial.appliedUsd).toBe('0.025')
    expect(m.model).toHaveBeenCalledOnce()
    expect(m.download).toHaveBeenCalledExactlyOnceWith({
      key: 'copilot/source.png',
      context: 'copilot',
    })
    const command = m.model.mock.calls[0]![0]
    expect(command).toMatchObject({
      scope: { actorUserId: 'actual-actor', workspaceId: null },
      input: {
        content: [
          { type: 'text', text: 'Describe image' },
          {
            type: 'image',
            image: `data:image/png;base64,${png.toString('base64')}`,
            mediaType: 'image/png',
          },
        ],
      },
    })
    expect(command).not.toHaveProperty('fileAttachments')
    expect(JSON.stringify(command)).not.toMatch(
      /sourceProof|copilot\/source|test-source-ingress-pepper/
    )
    expect(m.contexts.mock.invocationCallOrder[0]).toBeLessThan(
      m.download.mock.invocationCallOrder[0]!
    )
  })
  it('preserves genuine authorized conversation workspace while source remains private to actor', async () => {
    expect((await post([await source()], 'workspace')).status).toBe(200)
    expect(m.access).toHaveBeenCalledWith('workspace', 'actual-actor')
    expect(m.model.mock.calls[0]![0].scope.workspaceId).toBe('workspace')
  })
  it('denies cross-user signed source and a mixed batch before any speculative context or byte retrieval', async () => {
    const mine = await source()
    const foreign = await source('other-actor', 'copilot/foreign.png')
    expect((await post([foreign])).status).toBe(403)
    expect((await post([mine, foreign])).status).toBe(403)
    noContacts()
  })
  it('denies revoked conversation workspace before any image/model work', async () => {
    m.access.mockResolvedValue({ hasAccess: false })
    expect((await post([await source()], 'denied')).status).toBe(403)
    noContacts()
  })
  it('refuses unsigned, mismatched key/display media and rotated storage identity', async () => {
    const valid = await source()
    for (const attachment of [
      { key: valid.key, sourceProof: 'unsigned' },
      { ...valid, key: 'copilot/other.png' },
      { ...valid, media_type: 'image/jpeg' },
    ])
      expect((await post([attachment])).status).toBe(403)
    m.bucket = 'different-store'
    expect((await post([valid])).status).toBe(403)
    noContacts()
  })
  it('valid HMAC for wrong storage context still cannot authorize source ingress', async () => {
    const original = await source()
    const [header, payload] = original.sourceProof.split('.')
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    claims.context = 'chat'
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const unsigned = `${header}.${encoded}`
    const proof = `${unsigned}.${createHmac('sha256', 'test-source-ingress-pepper').update(unsigned).digest('base64url')}`
    expect((await post([{ ...original, sourceProof: proof }])).status).toBe(403)
    noContacts()
  })
  it('missing actual session prevents source admission despite valid signed descriptor', async () => {
    m.session.mockResolvedValue(null)
    expect((await post([await source()])).status).toBe(401)
    noContacts()
  })
  it('retains image selection order after the original text with no source locator on wire', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
    )
    m.download.mockResolvedValueOnce(png).mockResolvedValueOnce(svg)
    expect(
      (
        await post([
          await source(),
          await source('actual-actor', 'copilot/second.svg', svg, 'image/svg+xml'),
        ])
      ).status
    ).toBe(200)
    expect(m.model.mock.calls[0]![0].input.content).toEqual([
      { type: 'text', text: 'Describe image' },
      {
        type: 'image',
        image: `data:image/png;base64,${png.toString('base64')}`,
        mediaType: 'image/png',
      },
      {
        type: 'image',
        image: `data:image/svg+xml;base64,${svg.toString('base64')}`,
        mediaType: 'image/svg+xml',
      },
    ])
  })
  it('refuses context authorization failure before any authorized image bytes are retrieved', async () => {
    m.contexts.mockRejectedValueOnce(new Error('Context denied'))
    expect((await post([await source()])).status).toBe(422)
    expect(m.download).not.toHaveBeenCalled()
    expect(m.model).not.toHaveBeenCalled()
  })
  it('freshly rechecks workspace access after context resolution before bytes', async () => {
    m.contexts.mockImplementationOnce(async () => {
      m.access.mockResolvedValue({ hasAccess: false })
      return []
    })
    expect((await post([await source()], 'workspace')).status).toBe(403)
    expect(m.download).not.toHaveBeenCalled()
    expect(m.model).not.toHaveBeenCalled()
  })
  it('does not treat earlier source authorization as delivery authority after it expires', async () => {
    vi.useFakeTimers()
    const descriptor = await source()
    m.contexts.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 3_600_001)
      return []
    })
    expect((await post([descriptor])).status).toBe(403)
    expect(m.download).not.toHaveBeenCalled()
    expect(m.model).not.toHaveBeenCalled()
  })
  it('never delegates a partial image batch after a later missing object', async () => {
    m.download
      .mockResolvedValueOnce(png)
      .mockRejectedValueOnce(new Error('private store diagnostic'))
    const result = await post([await source(), await source('actual-actor', 'copilot/second.png')])
    expect(result.status).toBe(422)
    expect(await result.text()).toContain('upload the image again')
    expect(m.model).not.toHaveBeenCalled()
  })
  it('refuses actual malformed bytes despite matching source signature and metadata', async () => {
    const incomplete = png.subarray(0, 20)
    m.download.mockResolvedValueOnce(incomplete)
    expect(
      (await post([await source('actual-actor', 'copilot/broken.png', incomplete)])).status
    ).toBe(415)
    expect(m.model).not.toHaveBeenCalled()
  })
  it('cancels source delivery before any model delegation', async () => {
    const controller = new AbortController()
    m.download.mockImplementationOnce(async () => {
      controller.abort()
      return png
    })
    await post([await source()], null, controller.signal)
    expect(m.model).not.toHaveBeenCalled()
  })
})
