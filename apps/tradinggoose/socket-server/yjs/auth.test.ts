/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyOneTimeToken = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      verifyOneTimeToken: mockVerifyOneTimeToken,
    },
  },
}))

describe('authenticateYjsConnection', () => {
  beforeEach(() => {
    vi.resetModules()
    mockVerifyOneTimeToken.mockReset()
  })

  it('normalizes Better Auth invalid-token errors into YjsAuthError', async () => {
    mockVerifyOneTimeToken.mockRejectedValue({
      body: { code: 'INVALID_TOKEN', message: 'Invalid token' },
      statusCode: 400,
      name: 'APIError',
    })

    const { authenticateYjsConnection } = await import('./auth')

    await expect(
      authenticateYjsConnection(
        new URL(
          'http://localhost:3002/yjs/workflow-1?token=test-token&targetKind=workflow&sessionId=workflow-1&workflowId=workflow-1&entityKind=workflow&entityId=workflow-1'
        )
      )
    ).rejects.toMatchObject({
      name: 'YjsAuthError',
      code: 401,
      message: 'Invalid or expired token',
    })
  })
})
