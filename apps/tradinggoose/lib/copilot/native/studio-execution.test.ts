import { describe, expect, it } from 'vitest'
import { parseStudioNativeTarget } from './studio-execution'

const native = {
  workspaceId: null,
  target: {
    threadId: 'thread',
    resourceId: 'resource',
    runId: 'run',
    toolCallId: 'call',
    toolName: 'run_workflow',
  },
}
describe('browser business effect target envelope', () => {
  it.each([null, 'workspace'])(
    'preserves only the conversation scope and target for %j',
    async (workspaceId) => {
      const input = { ...native, workspaceId }
      expect(await parseStudioNativeTarget(input)).toEqual(input)
    }
  )
  it.each(['result', 'proof', 'payload', 'originalArgs', 'actorUserId', 'action'])(
    'rejects caller-supplied %s outside the target',
    async (field) => {
      await expect(parseStudioNativeTarget({ ...native, [field]: {} })).rejects.toThrow()
    }
  )
  it.each(['threadId', 'resourceId', 'runId', 'toolCallId', 'toolName'])(
    'requires a nonempty %s lookup',
    async (field) => {
      await expect(
        parseStudioNativeTarget({ ...native, target: { ...native.target, [field]: '' } })
      ).rejects.toThrow()
    }
  )
  it('rejects effect payloads or runtime controls inside the target', async () => {
    for (const field of ['originalArgs', 'resumeData', 'approved', 'workspaceId'])
      await expect(
        parseStudioNativeTarget({ ...native, target: { ...native.target, [field]: {} } })
      ).rejects.toThrow()
  })
})
