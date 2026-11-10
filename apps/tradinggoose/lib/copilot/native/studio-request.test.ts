import { describe, expect, it } from 'vitest'
import { parseStudioNativeCommand } from './studio-request'

const listing = {
  requestId: 'request',
  workspaceId: null,
  command: 'threads.list',
  page: { page: 0, perPage: 100 },
}
const message = {
  requestId: 'request',
  command: 'message',
  workspaceId: null,
  input: { content: 'hello' },
  model: 'model',
  stream: true,
}
describe('authenticated Studio command boundary', () => {
  it('requires explicit personal or workspace scope', async () => {
    await expect(parseStudioNativeCommand(listing)).resolves.toEqual(listing)
    await expect(
      parseStudioNativeCommand({ ...listing, workspaceId: 'workspace' })
    ).resolves.toMatchObject({ workspaceId: 'workspace' })
    const { workspaceId: _, ...missing } = listing
    await expect(parseStudioNativeCommand(missing)).rejects.toThrow()
  })
  it.each([
    { scope: { actorUserId: 'foreign', workspaceId: null } },
    { actorUserId: 'foreign' },
    { toolManifest: {} },
    { protocolRevision: 'retired' },
    { url: 'https://foreign.invalid' },
  ])('rejects client-owned trusted fields %j', async (extra) => {
    await expect(parseStudioNativeCommand({ ...listing, ...extra })).rejects.toThrow()
  })
  it.each(['limited', 'full'])('accepts the %s access preference', async (accessLevel) => {
    await expect(parseStudioNativeCommand({ ...message, accessLevel })).resolves.toMatchObject({
      accessLevel,
    })
  })
  it('accepts signed source descriptors and forbids browser-authored image parts', async () => {
    const fileAttachments = [
      {
        key: 'copilot/image.png',
        sourceProof: 'proof',
        filename: 'image.png',
        media_type: 'image/png',
        size: 8,
      },
    ]
    await expect(parseStudioNativeCommand({ ...message, fileAttachments })).resolves.toMatchObject({
      fileAttachments,
    })
    await expect(
      parseStudioNativeCommand({ ...message, fileAttachments: [{ key: 'copilot/image.png' }] })
    ).rejects.toThrow()
    await expect(
      parseStudioNativeCommand({
        ...message,
        input: {
          content: [{ type: 'image', image: 'data:image/png;base64,AA==', mediaType: 'image/png' }],
        },
      })
    ).rejects.toThrow()
  })
})
