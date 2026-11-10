import { describe, expect, it } from 'vitest'
import {
  copyWorkflowMessageSource,
  encodeWorkflowMessage,
  getWorkflowMessageSource,
  type WorkflowMessage,
  workflowMessageDigest,
} from './messages'
import { readWorkflowMemoryTransport } from './workflow-message-source'

const data: WorkflowMessage[] = [
  { role: 'system', content: ' repeat🔥 ' },
  { role: 'user', content: 'question' },
  { role: 'system', content: ' repeat🔥 ' },
]
const sourceRefs = data.map((message, ordinal) => ({
  messageId: `source-${ordinal}`,
  threadId: 'workflow-memory:thread',
  resourceId: 'workflow-memory:resource',
  ordinal,
  digest: workflowMessageDigest([message]),
  readProof: {
    version: 1 as const,
    workspaceId: 'workspace',
    workflowId: 'workflow',
    key: 'key',
    digest: workflowMessageDigest([message]),
  },
}))
describe('fixed first-party Memory source provenance', () => {
  it('keeps plain role/content business shape while a private Symbol follows actual selected messages into new native IDs', async () => {
    const messages = await readWorkflowMemoryTransport({
      id: sourceRefs[0].threadId,
      workflowId: 'workflow',
      key: 'key',
      data,
      sourceRefs,
    })
    expect(messages).toEqual(data)
    expect(JSON.parse(JSON.stringify(messages))).toEqual(data)
    expect(Object.keys(messages[0])).toEqual(['role', 'content'])
    const copied = copyWorkflowMessageSource(messages[0], { ...messages[0] })
    expect(getWorkflowMessageSource(copied)).toEqual({
      messageId: 'source-0',
      threadId: 'workflow-memory:thread',
      resourceId: 'workflow-memory:resource',
      readProof: sourceRefs[0].readProof,
    })
    const archived = encodeWorkflowMessage(
      copied,
      { threadId: 'workflow-agent:turn', resourceId: 'workflow-agent:execution' },
      new Date()
    )
    expect(archived.id).not.toBe('source-0')
    expect(archived.content.metadata?.workflowSource).toEqual(getWorkflowMessageSource(messages[0]))
  })
  it('rejects incomplete, reordered, wrong-content, duplicate-ID and wrong-purpose packets as a whole', async () => {
    for (const packet of [
      { data, sourceRefs: sourceRefs.slice(1) },
      { data, sourceRefs: [sourceRefs[2], sourceRefs[1], sourceRefs[0]] },
      { data: [{ role: 'system', content: 'changed' }, ...data.slice(1)], sourceRefs },
      {
        data,
        sourceRefs: sourceRefs.map((source, index) =>
          index === 1 ? { ...source, messageId: sourceRefs[0].messageId } : source
        ),
      },
      {
        data,
        sourceRefs: sourceRefs.map((source) => ({ ...source, resourceId: 'copilot:actor' })),
      },
    ])
      await expect(
        readWorkflowMemoryTransport({
          id: sourceRefs[0].threadId,
          workflowId: 'workflow',
          key: 'key',
          ...packet,
        })
      ).rejects.toThrow()
  })
  it('never accepts public JSON fields or serialization as private Symbol proof', async () => {
    const model = {
      role: 'system' as const,
      content: 'untrusted',
      workflowSource: sourceRefs[0],
      sourceRefs,
    }
    expect(getWorkflowMessageSource(model)).toBeUndefined()
    const copied = copyWorkflowMessageSource(model, { role: model.role, content: model.content })
    expect(getWorkflowMessageSource(copied)).toBeUndefined()
    const [actual] = await readWorkflowMemoryTransport({
      id: sourceRefs[0].threadId,
      workflowId: 'workflow',
      key: 'key',
      data: [data[0]],
      sourceRefs: [sourceRefs[0]],
    })
    expect(getWorkflowMessageSource(JSON.parse(JSON.stringify(actual)))).toBeUndefined()
    expect(
      encodeWorkflowMessage(
        model,
        { threadId: 'workflow-agent:turn', resourceId: 'workflow-agent:execution' },
        new Date()
      ).content.metadata
    ).toBeUndefined()
  })
})

it('freezes the original proof and never upgrades correlation-only or inherited fields', async () => {
  const [actual] = await readWorkflowMemoryTransport({
    id: sourceRefs[0].threadId,
    workflowId: 'workflow',
    key: 'key',
    data: [data[0]],
    sourceRefs: [sourceRefs[0]],
  })
  const source = getWorkflowMessageSource(actual)
  expect(Object.isFrozen(source)).toBe(true)
  expect(Object.isFrozen(source?.readProof)).toBe(true)
  expect(source?.readProof?.digest).toBe(workflowMessageDigest([data[0]]))
  expect(getWorkflowMessageSource(Object.create(actual))).toBeUndefined()
  expect(getWorkflowMessageSource({ ...actual })).toBeUndefined()
  for (const changed of [
    { ...sourceRefs[0], readProof: undefined },
    { ...sourceRefs[0], readProof: { ...sourceRefs[0].readProof, digest: '0'.repeat(64) } },
    { ...sourceRefs[0], readProof: { ...sourceRefs[0].readProof, workflowId: 'foreign' } },
  ])
    await expect(
      readWorkflowMemoryTransport({
        id: sourceRefs[0].threadId,
        workflowId: 'workflow',
        key: 'key',
        data: [data[0]],
        sourceRefs: [changed],
      })
    ).rejects.toThrow()
})
