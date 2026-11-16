import { expect, it } from 'vitest'
import { CopilotRequestSchema } from './contract'

it('accepts the browser command with ordered native content parts', () => {
  const input = {
    command: 'message',
    requestId: crypto.randomUUID(),
    workspaceId: 'workspace',
    model: 'openai/gpt-4.1',
    providerOptions: { openai: { reasoningEffort: 'high' } },
    input: {
      content: [
        { type: 'text', text: 'Inspect this' },
        { type: 'image', image: 'data:image/png;base64,aW1hZ2U=', mediaType: 'image/png' },
      ],
    },
  }
  expect(CopilotRequestSchema.parse(input)).toEqual(input)
})
it.each([undefined, '', 'not-a-uuid'])('requires a stable admission UUID: %s', (requestId) => {
  expect(
    CopilotRequestSchema.safeParse({
      command: 'message',
      workspaceId: null,
      requestId,
      model: 'openai/gpt-4.1',
      input: { content: 'Hello' },
    }).success
  ).toBe(false)
})
it.each([
  { actorUserId: 'other' },
  { scope: { actorUserId: 'other', workspaceId: 'workspace' } },
  { stream: false },
  { workflowId: 'workflow' },
  {
    providerOptions: {
      anthropic: {
        mcpServers: [
          {
            type: 'url',
            name: 'unapproved',
            url: 'https://tools.example.test/mcp',
            authorizationToken: 'untrusted-token',
            toolConfiguration: { enabled: true },
          },
        ],
      },
    },
  },
  { reasoningEffort: 'low' },
  { fileAttachments: [{ key: 'old-object-reference' }] },
])('rejects additional authority and retired transport fields: %j', (fields) => {
  expect(() =>
    CopilotRequestSchema.parse({
      command: 'message',
      requestId: crypto.randomUUID(),
      workspaceId: 'workspace',
      model: 'openai/gpt-4.1',
      input: { content: 'Hello' },
      ...fields,
    })
  ).toThrow()
})
it.each([
  { action: 'review.accept' },
  {
    action: 'execute',
    target: {
      threadId: 'thread',
      resourceId: 'resource',
      runId: 'run',
      toolCallId: 'call',
      toolName: 'rename_workflow',
    },
  },
])('requires supported tool decisions with a concrete pending target: %j', (fields) => {
  expect(() =>
    CopilotRequestSchema.parse({
      command: 'tool.execute',
      requestId: crypto.randomUUID(),
      workspaceId: 'workspace',
      ...fields,
    })
  ).toThrow()
})
