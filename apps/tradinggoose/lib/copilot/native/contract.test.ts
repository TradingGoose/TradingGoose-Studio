import { expect, it } from 'vitest'
import { CopilotRequestSchema } from './contract'

it('accepts the browser command with ordered native content parts', () => {
  const input = {
    command: 'message',
    workspaceId: 'workspace',
    model: 'openai/gpt-4.1',
    input: {
      content: [
        { type: 'text', text: 'Inspect this' },
        { type: 'image', image: 'data:image/png;base64,aW1hZ2U=', mediaType: 'image/png' },
      ],
    },
  }
  expect(CopilotRequestSchema.parse(input)).toEqual(input)
})
it.each([
  { actorUserId: 'other' },
  { scope: { actorUserId: 'other', workspaceId: 'workspace' } },
  { stream: false },
  { fileAttachments: [{ key: 'old-object-reference' }] },
])('rejects additional authority and retired transport fields: %j', (fields) => {
  expect(() =>
    CopilotRequestSchema.parse({
      command: 'message',
      workspaceId: 'workspace',
      model: 'openai/gpt-4.1',
      input: { content: 'Hello' },
      ...fields,
    })
  ).toThrow()
})
it('requires a concrete pending target for tool decisions', () => {
  expect(() =>
    CopilotRequestSchema.parse({
      command: 'tool.execute',
      workspaceId: 'workspace',
      action: 'review.accept',
    })
  ).toThrow()
})
