/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pending } from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  scope: vi.fn(),
  pending: vi.fn(),
  access: vi.fn(),
  route: vi.fn(),
  stage: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  readback: vi.fn(),
  proof: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: mocks.access,
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: mocks.readback }))
vi.mock('@/lib/copilot/native/target', async (original) => ({
  ...(await original<typeof import('@/lib/copilot/native/target')>()),
  NativeTargetError: class NativeTargetError extends Error {
    constructor(
      message: string,
      public status = 409
    ) {
      super(message)
    }
  },
  authorizeNativeConversationScope: mocks.scope,
  resolveNativePendingTarget: mocks.pending,
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: mocks.route }))
vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  acceptServerManagedToolReview: mocks.accept,
  rejectServerManagedToolReview: mocks.reject,
  stageServerManagedToolReview: mocks.stage,
}))
vi.mock('@/lib/copilot/result-proof', () => ({ createCopilotToolResultProof: mocks.proof }))
const scope = { actorUserId: 'actual-actor', workspaceId: null }
function pending(): Pending {
  return {
    target: {
      resourceId: nativeConversationIdentity(scope).resourceId,
      threadId: 'thread',
      runId: 'run',
      toolCallId: 'call',
      toolName: 'search_online',
    },
    stage: 'result',
    originalArgs: { query: 'actual native query' },
    financialBinding: {
      namespace: 'billing',
      key: 'key',
      fingerprint: 'fingerprint',
      actorUserId: 'actual-actor',
      workspaceId: null,
      workflowId: null,
      runId: 'run',
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 4, retryCount: 0 },
  }
}
function envelope(action = 'execute') {
  return { native: { workspaceId: null, target: pending().target }, action }
}
async function post(body: unknown) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.example.test/api/copilot/execute-copilot-server-tool', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'actual-actor' } })
  mocks.scope.mockResolvedValue(scope)
  mocks.pending.mockImplementation(async () => pending())
  mocks.route.mockResolvedValue({ results: [], query: 'actual native query' })
  mocks.stage.mockImplementation(async (_name, _args, result) => result)
  mocks.accept.mockResolvedValue({ results: [] })
  mocks.readback.mockResolvedValue({ results: [] })
  mocks.proof.mockResolvedValue('purpose-specific-proof')
})
describe('native-bound Studio business execution', () => {
  it('uses actual session, original native args and genuine binding before effect and proof', async () => {
    const response = await post(envelope())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      result: { results: [], query: 'actual native query' },
      proof: 'purpose-specific-proof',
    })
    expect(mocks.scope).toHaveBeenCalledWith('actual-actor', null)
    expect(mocks.pending).toHaveBeenCalledTimes(2)
    expect(mocks.route).toHaveBeenCalledExactlyOnceWith(
      'search_online',
      { query: 'actual native query', num: 10, type: 'search' },
      expect.objectContaining({
        userId: 'actual-actor',
        accessLevel: 'limited',
        nativeReviewBinding: expect.any(String),
        signal: expect.any(AbortSignal),
      })
    )
    expect(mocks.proof).toHaveBeenCalledWith(
      expect.objectContaining({
        originalArgs: pending().originalArgs,
        binding: expect.objectContaining({
          workspaceId: null,
          actorId: 'actual-actor',
          toolCallId: 'call',
          financialRootId: '["billing","key","fingerprint"]',
        }),
      })
    )
    expect(mocks.pending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.route.mock.invocationCallOrder[0]!
    )
    expect(mocks.access.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.proof.mock.invocationCallOrder[0]!
    )
  })
  it.each(['toolName', 'payload', 'reviewAction', 'headers', 'url'])(
    'refuses client supplied %s before any business effect',
    async (key) => {
      expect((await post({ ...envelope(), [key]: 'untrusted' })).status).toBeGreaterThanOrEqual(400)
      expect(mocks.route).not.toHaveBeenCalled()
      expect(mocks.proof).not.toHaveBeenCalled()
    }
  )
  it('rejects unauthenticated calls without native discovery', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await post(envelope())).status).toBe(401)
    expect(mocks.pending).not.toHaveBeenCalled()
  })
  it('stale native stage, original finance or revoked permission prevents execution', async () => {
    mocks.pending.mockRejectedValue(new Error('Financial acceptance unavailable'))
    expect((await post(envelope())).status).toBeGreaterThanOrEqual(400)
    expect(mocks.route).not.toHaveBeenCalled()
    mocks.pending.mockImplementation(async () => pending())
    mocks.access.mockRejectedValue(new Error('Access revoked'))
    expect((await post(envelope())).status).toBeGreaterThanOrEqual(400)
    expect(mocks.route).not.toHaveBeenCalled()
  })
  it('stages a business review without authorizing a final native result', async () => {
    mocks.stage.mockResolvedValue({ requiresReview: true, reviewToken: 'token' })
    expect(await (await post(envelope())).json()).toEqual({
      success: true,
      result: { requiresReview: true, reviewToken: 'token' },
    })
    expect(mocks.proof).not.toHaveBeenCalled()
    expect(mocks.pending).toHaveBeenCalledOnce()
  })
  it('binds review acceptance to native identity', async () => {
    expect(
      (
        await post({
          ...envelope('review.accept'),
          reviewToken: 'original-token',
          accessLevel: 'full',
        })
      ).status
    ).toBe(200)
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(
      'search_online',
      'original-token',
      expect.objectContaining({ accessLevel: 'limited', nativeReviewBinding: expect.any(String) })
    )
    expect(mocks.route).not.toHaveBeenCalled()
    expect(mocks.proof).toHaveBeenCalledOnce()
  })
  it('readback never redispatches original effects', async () => {
    expect((await post(envelope('readback'))).status).toBe(200)
    expect(mocks.readback).toHaveBeenCalledOnce()
    expect(mocks.route).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
  })
  it('does not issue proof or repeat effects when native pending changes after execution', async () => {
    mocks.pending
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce({ ...pending(), originalArgs: { query: 'changed' } })
    expect((await post(envelope())).status).toBe(409)
    expect(mocks.route).toHaveBeenCalledOnce()
    expect(mocks.proof).not.toHaveBeenCalled()
  })
  it('proof failure never causes automatic business retry', async () => {
    mocks.proof.mockRejectedValue(new Error('Signing unavailable'))
    expect((await post(envelope())).status).toBeGreaterThanOrEqual(400)
    expect(mocks.route).toHaveBeenCalledOnce()
  })
  it('rejects browser business effects through server execution', async () => {
    const browser = {
      ...pending(),
      target: { ...pending().target, toolName: 'run_workflow' },
      originalArgs: { entityId: 'workflow', triggerBlockId: 'trigger' },
    }
    mocks.pending.mockResolvedValue(browser)
    expect(
      (await post({ ...envelope(), native: { workspaceId: null, target: browser.target } })).status
    ).toBe(422)
    expect(mocks.route).not.toHaveBeenCalled()
  })
  it('returns only a signed tool-specific rejection from the current server preview decision', async () => {
    const item = {
      ...pending(),
      target: { ...pending().target, toolName: 'edit_workflow' },
      originalArgs: { entityId: 'workflow', entityDocument: 'document' },
    }
    mocks.pending.mockResolvedValue(item)
    const result = { success: false, rejected: true, toolName: 'edit_workflow' }
    mocks.reject.mockResolvedValue(result)
    const response = await post({
      native: { workspaceId: null, target: item.target },
      action: 'review.reject',
      reviewToken: 'original-token',
      accessLevel: 'full',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      result,
      proof: 'purpose-specific-proof',
    })
    expect(mocks.reject).toHaveBeenCalledExactlyOnceWith(
      'edit_workflow',
      'original-token',
      expect.objectContaining({
        userId: 'actual-actor',
        accessLevel: 'limited',
        nativeReviewBinding: expect.any(String),
      })
    )
    expect(mocks.route).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.proof).toHaveBeenCalledWith(
      expect.objectContaining({ originalArgs: item.originalArgs, result })
    )
  })
  it('does not sign a rejected decision after original Pending/finance changes', async () => {
    const item = {
      ...pending(),
      target: { ...pending().target, toolName: 'edit_workflow' },
      originalArgs: { entityId: 'workflow', entityDocument: 'document' },
    }
    mocks.pending
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ ...item, financialOccurrence: { stepNumber: 99, retryCount: 0 } })
    mocks.reject.mockResolvedValue({ success: false, rejected: true, toolName: 'edit_workflow' })
    expect(
      (
        await post({
          native: { workspaceId: null, target: item.target },
          action: 'review.reject',
          reviewToken: 'token',
        })
      ).status
    ).toBe(409)
    expect(mocks.reject).toHaveBeenCalledOnce()
    expect(mocks.proof).not.toHaveBeenCalled()
    expect(mocks.route).not.toHaveBeenCalled()
  })
  it('token/authorization failures do not fabricate a rejected proof', async () => {
    mocks.reject.mockRejectedValue(new Error('claimed or expired token'))
    const response = await post({ ...envelope('review.reject'), reviewToken: 'token' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.proof).not.toHaveBeenCalled()
    expect(mocks.route).not.toHaveBeenCalled()
  })
})

it('rejects an unbranded native docs Pending even when JSON contains financial lookalikes', async () => {
  const value = pending()
  value.target.toolName = 'search_documentation'
  value.originalArgs = { query: 'docs' }
  mocks.pending.mockResolvedValue(
    Object.assign(value, {
      financialSource: { binding: value.financialBinding, accepted: true },
    })
  )
  const response = await post({
    native: { workspaceId: null, target: value.target },
    action: 'execute',
  })
  expect(response.status).toBe(403)
  expect(mocks.route).not.toHaveBeenCalled()
  expect(mocks.proof).not.toHaveBeenCalled()
})
it('rejects caller-added financial context instead of accepting it as internal authority', async () => {
  const response = await post({
    ...envelope(),
    context: {
      workspaceId: 'business-workspace',
      financialSource: { namespace: 'forged', actorUserId: 'forged' },
    },
  })
  expect(response.status).toBe(422)
  expect(mocks.pending).not.toHaveBeenCalled()
  expect(mocks.route).not.toHaveBeenCalled()
})
