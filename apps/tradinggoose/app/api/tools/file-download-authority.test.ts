import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  download: vi.fn(),
  auth: vi.fn(),
  credential: vi.fn(),
  provider: vi.fn(),
  s3Send: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: state.auth }))
vi.mock('@/lib/credentials/oauth-route', () => ({ resolveOAuthRouteCredential: state.credential }))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'request' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveAuthorizedWorkspaceFileReference: vi.fn(),
}))
vi.mock('@/lib/uploads/utils/file-processing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads/utils/file-processing')>()
  return { ...actual, downloadFileFromStorage: state.download }
})
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = state.s3Send
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { ArchiveAccessError } from '@/lib/uploads/archive-boundary'
import { PrivateSourceAccessError } from '@/lib/uploads/source-read-boundary'

const file = {
  id: 'file-a',
  name: 'image.png',
  size: 3,
  type: 'image/png',
  key: 'workspace-a/file.png',
  context: 'workspace',
  uploadedAt: '2026-11-10T00:00:00.000Z',
  path: '/api/files/serve/workspace-a/file.png?context=workspace&workspaceId=workspace-a&fileId=file-a',
  url: '/api/files/serve/workspace-a/file.png?context=workspace&workspaceId=workspace-a&fileId=file-a',
}
const mail = {
  credentialId: 'credential',
  to: 'recipient@example.invalid',
  subject: 'test',
  body: 'message',
  attachments: [file],
}
const routes = [
  {
    name: 'Slack',
    load: () => import('./slack/send-message/route'),
    body: { credentialId: 'credential', channel: 'channel', text: 'message', files: [file] },
    oauth: true,
  },
  { name: 'Gmail send', load: () => import('./gmail/send/route'), body: mail, oauth: true },
  { name: 'Gmail draft', load: () => import('./gmail/draft/route'), body: mail, oauth: true },
  {
    name: 'OneDrive',
    load: () => import('./onedrive/upload/route'),
    body: { credentialId: 'credential', fileName: 'image.png', file },
    oauth: true,
  },
  {
    name: 'S3',
    load: () => import('./s3/put-object/route'),
    body: {
      accessKeyId: 'synthetic',
      secretAccessKey: 'synthetic',
      region: 'unit',
      bucketName: 'unit',
      objectKey: 'image.png',
      file,
    },
    oauth: false,
  },
  {
    name: 'Telegram',
    load: () => import('./telegram/send-document/route'),
    body: { botToken: 'synthetic', chatId: 'chat', files: [file] },
    oauth: false,
  },
  {
    name: 'Google Drive',
    load: () => import('./google_drive/upload/route'),
    body: { credentialId: 'credential', fileName: 'image.png', file },
    oauth: true,
  },
  {
    name: 'Teams chat',
    load: () => import('./microsoft_teams/write_chat/route'),
    body: { credentialId: 'credential', chatId: 'chat', content: 'message', files: [file] },
    oauth: true,
  },
  {
    name: 'Teams channel',
    load: () => import('./microsoft_teams/write_channel/route'),
    body: {
      credentialId: 'credential',
      teamId: 'team',
      channelId: 'channel',
      content: 'message',
      files: [file],
    },
    oauth: true,
  },
  {
    name: 'Discord',
    load: () => import('./discord/send-message/route'),
    body: { botToken: 'synthetic', channelId: 'channel', content: 'message', files: [file] },
    oauth: false,
  },
  { name: 'Outlook send', load: () => import('./outlook/send/route'), body: mail, oauth: true },
  { name: 'Outlook draft', load: () => import('./outlook/draft/route'), body: mail, oauth: true },
  {
    name: 'SharePoint',
    load: () => import('./sharepoint/upload/route'),
    body: { credentialId: 'credential', driveId: 'original-drive', files: [file] },
    oauth: true,
  },
]
function request(body: unknown) {
  return new NextRequest('http://localhost/api/tools/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.mockResolvedValue({
    success: true,
    userId: 'hybrid-requester',
    workspaceId: 'hybrid-workspace',
  })
  state.credential.mockResolvedValue({
    ok: true,
    accessToken: 'synthetic-token',
    credentialId: 'credential',
    requesterUserId: 'oauth-requester',
    workspaceId: 'oauth-workspace',
  })
  state.download.mockRejectedValue(new PrivateSourceAccessError())
  state.provider.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, content: 'text', id: 'result' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  state.s3Send.mockResolvedValue({ ETag: 'unit' })
  vi.stubGlobal('fetch', state.provider)
})

afterEach(() => vi.unstubAllGlobals())

describe('all thirteen non-Vision download owners', () => {
  it.each(routes)(
    '$name passes verified authority and signal and preserves protected403 before effect',
    async (fixture) => {
      const route = await fixture.load()
      const input = request({
        ...fixture.body,
        requesterUserId: 'forged',
        workspaceId: 'forged-workspace',
        _context: { userId: 'forged' },
      })
      const response = await route.POST(input)
      expect(state.download).toHaveBeenCalledTimes(1)
      expect(state.download.mock.calls[0][3]).toEqual({
        actorUserId: fixture.oauth ? 'oauth-requester' : 'hybrid-requester',
        workspaceId: fixture.oauth ? 'oauth-workspace' : 'hybrid-workspace',
        signal: input.signal,
      })
      expect(response.status).toBe(403)
      expect(state.provider).not.toHaveBeenCalled()
      expect(state.s3Send).not.toHaveBeenCalled()
    }
  )
  it.each(routes)(
    '$name does not skip an encoded archive attachment into a text effect',
    async (fixture) => {
      const route = await fixture.load()
      const badFile = {
        ...file,
        path: '/api/files/serve/%252fworkflow-archive',
        key: 'archived-enhanced-logs/private.json',
      }
      const body = { ...fixture.body, file: badFile, files: [badFile], attachments: [badFile] }
      const response = await route.POST(request(body))
      expect(response.status).toBe(403)
      expect(state.download).not.toHaveBeenCalled()
      expect(state.provider).not.toHaveBeenCalled()
      expect(state.s3Send).not.toHaveBeenCalled()
    }
  )
  it.each(routes.filter((route) => !route.oauth))(
    '$name refuses actorless attachment requests without borrowing body identity',
    async (fixture) => {
      state.auth.mockResolvedValue({ success: true, authType: 'internal_jwt' })
      const route = await fixture.load()
      const response = await route.POST(
        request({ ...fixture.body, requesterUserId: 'forged', _context: { userId: 'forged' } })
      )
      expect(response.status).toBe(403)
      expect(state.download).not.toHaveBeenCalled()
      expect(state.provider).not.toHaveBeenCalled()
      expect(state.s3Send).not.toHaveBeenCalled()
    }
  )
  it('keeps existing actorless S3/Discord content-only paths separate from file authority', async () => {
    state.auth.mockResolvedValue({ success: true, authType: 'internal_jwt' })
    const s3 = await import('./s3/put-object/route')
    const response = await s3.POST(
      request({
        accessKeyId: 'synthetic',
        secretAccessKey: 'synthetic',
        region: 'unit',
        bucketName: 'unit',
        objectKey: 'text.txt',
        content: 'text',
      })
    )
    expect(response.status).toBe(200)
    expect(state.s3Send).toHaveBeenCalledTimes(1)
    const discord = await import('./discord/send-message/route')
    expect(
      (
        await discord.POST(
          request({ botToken: 'synthetic', channelId: 'channel', content: 'text' })
        )
      ).status
    ).toBe(200)
    expect(state.provider).toHaveBeenCalledTimes(1)
    expect(state.download).not.toHaveBeenCalled()
  })
  it('preserves ArchiveAccessError actionability from the actual download boundary', async () => {
    state.download.mockRejectedValue(new ArchiveAccessError())
    const route = await import('./gmail/send/route')
    expect((await route.POST(request(mail))).status).toBe(403)
    expect(state.provider).not.toHaveBeenCalled()
  })
})
