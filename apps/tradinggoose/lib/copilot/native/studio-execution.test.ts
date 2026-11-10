import { describe, expect, it } from 'vitest'
import { parseStudioNativeExecutionRequest } from './studio-execution'

const native = {
  workspaceId: null,
  target: {
    threadId: 'thread',
    resourceId: 'resource',
    runId: 'run',
    toolCallId: 'call',
    toolName: 'edit_workflow',
  },
}
describe('internal server review decision envelope', () => {
  it.each(['review.accept', 'review.reject'] as const)(
    'accepts only the bound %s token lookup',
    async (action) => {
      const request = { native, action, reviewToken: 'original-token' }
      expect(await parseStudioNativeExecutionRequest(request)).toEqual(request)
      await expect(parseStudioNativeExecutionRequest({ native, action })).rejects.toThrow(
        'reviewToken'
      )
    }
  )
  it.each(['result', 'proof', 'payload', 'toolName', 'originalArgs'])(
    'refuses caller supplied %s',
    async (field) => {
      await expect(
        parseStudioNativeExecutionRequest({
          native,
          action: 'review.reject',
          reviewToken: 'token',
          [field]: {},
        })
      ).rejects.toThrow()
    }
  )
  it.each(['execute', 'readback'] as const)(
    'does not permit a review token on %s',
    async (action) => {
      await expect(
        parseStudioNativeExecutionRequest({ native, action, reviewToken: 'token' })
      ).rejects.toThrow('only permitted')
    }
  )
  it('keeps rejection separate from credential readback and native decline', async () => {
    await expect(
      parseStudioNativeExecutionRequest({
        native,
        action: 'review.reject',
        reviewToken: 'token',
        readback: { credentialId: 'credential' },
      })
    ).rejects.toThrow('Readback')
    await expect(
      parseStudioNativeExecutionRequest({ native, action: 'tool.decline', reviewToken: 'token' })
    ).rejects.toThrow()
  })
})
