import { describe, expect, it } from 'vitest'
import fixtures from './contract/fixtures.json'
import { parseStudioNativeCommand } from './studio-request'

const listing = {
  requestId: 'local-request',
  workspaceId: null,
  command: 'threads.list',
  page: { page: 0, perPage: 100 },
}

describe('schema-derived session command input', () => {
  it('preserves every valid canonical command while removing only server-authored envelope fields', async () => {
    for (const fixture of fixtures.fixtures) {
      if (fixture.schema !== 'CopilotRequest' || !fixture.schemaValid) continue
      const value = fixture.value
      if (
        !value ||
        typeof value !== 'object' ||
        !('scope' in value) ||
        !value.scope ||
        typeof value.scope !== 'object' ||
        !('workspaceId' in value.scope)
      ) {
        throw new Error(`Unexpected canonical command fixture ${fixture.id}`)
      }
      const request = {
        ...Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => !['scope', 'protocolRevision', 'toolManifest'].includes(key)
          )
        ),
        workspaceId: value.scope.workspaceId,
      }
      if (
        'command' in value &&
        value.command === 'message' &&
        'input' in value &&
        value.input &&
        typeof value.input === 'object' &&
        'content' in value.input &&
        typeof value.input.content !== 'string'
      ) {
        await expect(parseStudioNativeCommand(request), fixture.id).rejects.toThrow()
      } else {
        await expect(parseStudioNativeCommand(request), fixture.id).resolves.toEqual(request)
      }
    }
  })
  it('requires explicit genuine null versus workspace scope rather than choosing an ambient workspace', async () => {
    await expect(parseStudioNativeCommand(listing)).resolves.toEqual(listing)
    await expect(
      parseStudioNativeCommand({ ...listing, workspaceId: 'workspace' })
    ).resolves.toMatchObject({ workspaceId: 'workspace' })
    await expect(
      parseStudioNativeCommand({
        command: 'threads.list',
        requestId: 'request',
        page: listing.page,
      })
    ).rejects.toThrow()
  })
  it.each([
    { scope: { actorUserId: 'forged-owner', workspaceId: null } },
    { protocolRevision: 'unreviewed' },
    { toolManifest: { version: 'v1', tools: [] } },
    { actorUserId: 'forged-owner' },
    { requestContext: { trusted: true } },
    { url: 'https://attacker.invalid' },
    { maxRetries: 3 },
    { accessLevel: 'full' },
  ])('rejects client-authored trusted/control fields on a closed command: %j', async (extra) => {
    await expect(parseStudioNativeCommand({ ...listing, ...extra })).rejects.toThrow(
      'Invalid Studio'
    )
  })
  it('allows only the existing local full/limited message preference without an upstream manifest', async () => {
    for (const accessLevel of ['limited', 'full']) {
      await expect(
        parseStudioNativeCommand({
          requestId: 'message',
          command: 'message',
          workspaceId: null,
          input: { content: 'hello' },
          model: 'openai/gpt-5.6-terra',
          stream: true,
          accessLevel,
        })
      ).resolves.toMatchObject({ accessLevel })
    }
  })
  it('accepts only the local completed source descriptor and does not invent native image fields', async () => {
    const message = {
      requestId: 'source-message',
      command: 'message',
      workspaceId: null,
      input: { content: 'image' },
      model: 'openai/gpt-5.6-terra',
      stream: false,
    }
    await expect(
      parseStudioNativeCommand({
        ...message,
        fileAttachments: [
          {
            key: 'copilot/file.png',
            sourceProof: 'signed-source',
            filename: 'file.png',
            media_type: 'image/png',
            size: 8,
          },
        ],
      })
    ).resolves.toMatchObject({ fileAttachments: [{ sourceProof: 'signed-source' }] })
    await expect(
      parseStudioNativeCommand({ ...message, fileAttachments: [{ key: 'copilot/file.png' }] })
    ).rejects.toThrow()
    await expect(
      parseStudioNativeCommand({
        ...message,
        input: { content: 'image', images: [{ url: 'invented' }] },
      })
    ).rejects.toThrow()
    await expect(parseStudioNativeCommand({ ...listing, fileAttachments: [] })).rejects.toThrow()
    for (const content of [
      [{ type: 'text', text: 'image' }],
      [{ type: 'image', image: 'data:image/png;base64,AA==', mediaType: 'image/png' }],
      { type: 'image', url: 'https://foreign.invalid/image.png' },
    ])
      await expect(parseStudioNativeCommand({ ...message, input: { content } })).rejects.toThrow()
    await expect(
      parseStudioNativeCommand({ ...message, input: { text: 'retired text branch' } })
    ).rejects.toThrow()
  })
})
