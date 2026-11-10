import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pending, Scope, Target } from './contract'
import { nativeConversationIdentity, nativeResultBinding } from './identity'

const state = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), access: vi.fn() }))
vi.mock('./client', () => ({ readNativeCopilot: state.read }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: state.verify }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))

import {
  assertOriginalBusinessArguments,
  authorizeNativeConversationScope,
  copyNativeFinancialSource,
  getNativeFinancialSource,
  resolveNativePendingTarget,
} from './target'

const scope: Scope = { actorUserId: 'actor', workspaceId: null }
const target: Target = {
  resourceId: nativeConversationIdentity(scope).resourceId,
  threadId: 'thread',
  runId: 'native-run',
  toolCallId: 'tool-call',
  toolName: 'read_workflow',
}
function pending(): Pending {
  return {
    target,
    stage: 'result',
    originalArgs: { entityId: 'workflow', workspaceId: 'separately-authorized-entity-workspace' },
    financialBinding: {
      namespace: 'billing-usage:original-root',
      key: 'original-operation',
      fingerprint: 'original-fingerprint',
      actorUserId: scope.actorUserId,
      workspaceId: null,
      workflowId: null,
      runId: target.runId,
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 3, retryCount: 1, runId: target.runId },
  }
}
function page(items: Pending[], index = 0, hasMore = false) {
  return {
    status: 200,
    result: { status: 'pending_targets', items, page: { page: index, perPage: 100 }, hasMore },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.read.mockResolvedValue(page([pending()]))
  state.verify.mockResolvedValue({ accepted: true })
  state.access.mockResolvedValue({ hasAccess: true })
})

describe('fresh native target admission', () => {
  it('preserves personal null and independently verifies original financial binding/occurrence', async () => {
    const result = await resolveNativePendingTarget(scope, target, 'result')
    expect(result).toEqual(pending())
    expect(state.read).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        command: 'pending.list',
        scope,
        threadId: 'thread',
        page: { page: 0, perPage: 100 },
      }),
      undefined
    )
    expect(state.verify).toHaveBeenCalledExactlyOnceWith(pending().financialBinding, {
      stepNumber: 3,
      retryCount: 1,
      runId: 'native-run',
    })
    expect(nativeResultBinding(scope, result)).toMatchObject({
      actorId: 'actor',
      workspaceId: null,
      tenantId: '["personal","actor"]',
      resourceId: '["copilot","personal","actor","actor",null]',
      financialRootId:
        '["billing-usage:original-root","original-operation","original-fingerprint"]',
    })
    expect(result.originalArgs.workspaceId).toBe('separately-authorized-entity-workspace')
  })
  it('checks the actual authenticated actor for workspace access and does not invent a conversation workspace', async () => {
    expect(await authorizeNativeConversationScope('member', null)).toEqual({
      actorUserId: 'member',
      workspaceId: null,
    })
    expect(state.access).not.toHaveBeenCalled()
    expect(await authorizeNativeConversationScope('member', 'conversation-workspace')).toEqual({
      actorUserId: 'member',
      workspaceId: 'conversation-workspace',
    })
    expect(state.access).toHaveBeenCalledExactlyOnceWith('conversation-workspace', 'member')
    state.access.mockResolvedValueOnce({ hasAccess: false })
    await expect(authorizeNativeConversationScope('member', 'forbidden')).rejects.toMatchObject({
      status: 403,
    })
  })
  it.each(['', ' '])('refuses absent actual actor %j before authorization', async (actor) => {
    await expect(authorizeNativeConversationScope(actor, null)).rejects.toMatchObject({
      status: 401,
    })
    expect(state.access).not.toHaveBeenCalled()
  })
  it('refuses a wrong-scope resource or unknown tool before discovery/finance', async () => {
    await expect(
      resolveNativePendingTarget(scope, { ...target, resourceId: 'foreign' }, 'result')
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      resolveNativePendingTarget(scope, { ...target, toolName: 'unknown' }, 'result')
    ).rejects.toMatchObject({ status: 403 })
    expect(state.read).not.toHaveBeenCalled()
    expect(state.verify).not.toHaveBeenCalled()
  })
  it('reads every genuine page and accepts no other native target', async () => {
    state.read
      .mockResolvedValueOnce(
        page([{ ...pending(), target: { ...target, toolCallId: 'other' } }], 0, true)
      )
      .mockResolvedValueOnce(page([pending()], 1))
    expect(await resolveNativePendingTarget(scope, target, 'result')).toEqual(pending())
    expect(state.read).toHaveBeenCalledTimes(2)
    expect(state.read.mock.calls[1][0].page).toEqual({ page: 1, perPage: 100 })
    expect(state.verify).toHaveBeenCalledOnce()
  })
  it.each(['approval', 'result'] as const)(
    'does not confuse %s with the other suspension stage',
    async (stage) => {
      state.read.mockResolvedValueOnce(page([{ ...pending(), stage }]))
      await expect(
        resolveNativePendingTarget(scope, target, stage === 'approval' ? 'result' : 'approval')
      ).rejects.toThrow('wrong suspension stage')
      expect(state.verify).not.toHaveBeenCalled()
    }
  )
  it.each([
    { actorUserId: 'other' },
    { workspaceId: 'fake-personal-workspace' },
    { runId: 'different-run' },
    { purpose: 'wand' },
  ])('refuses changed original financial scope before business work: %j', async (change) => {
    const value = pending()
    state.read.mockResolvedValueOnce(
      page([{ ...value, financialBinding: { ...value.financialBinding, ...change } }])
    )
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toThrow(
      'original financial scope'
    )
    expect(state.verify).not.toHaveBeenCalled()
  })
  it('refuses conflicting optional native run identity without substituting occurrence0', async () => {
    state.read.mockResolvedValueOnce(
      page([
        { ...pending(), financialOccurrence: { stepNumber: 8, retryCount: 4, runId: 'other' } },
      ])
    )
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toThrow(
      'original financial scope'
    )
    expect(state.verify).not.toHaveBeenCalled()
  })
  it('accepts genuine occurrence0 and genuinely absent optional runId exactly', async () => {
    state.read.mockResolvedValueOnce(
      page([{ ...pending(), financialOccurrence: { stepNumber: 0, retryCount: 0 } }])
    )
    await resolveNativePendingTarget(scope, target, 'result')
    expect(state.verify).toHaveBeenCalledWith(pending().financialBinding, {
      stepNumber: 0,
      retryCount: 0,
    })
  })
  it('refuses absent/ambiguous targets and inconsistent pagination without acceptance', async () => {
    for (const value of [
      page([]),
      page([pending(), pending()]),
      page([], 0, true),
      page([pending()], 1),
    ]) {
      state.read.mockResolvedValueOnce(value)
      await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toThrow()
    }
    expect(state.verify).not.toHaveBeenCalled()
  })
  it('requires verified original financial acceptance rather than admitting another occurrence', async () => {
    state.verify.mockRejectedValueOnce(new Error('Original receipt is not accepted'))
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toThrow(
      'not accepted'
    )
    expect(state.read).toHaveBeenCalledOnce()
    expect(state.verify).toHaveBeenCalledOnce()
  })
  it('checks cancellation before discovery and after awaited acceptance', async () => {
    const first = new AbortController()
    first.abort()
    await expect(
      resolveNativePendingTarget(scope, target, 'result', first.signal)
    ).rejects.toThrow()
    expect(state.read).not.toHaveBeenCalled()
    const second = new AbortController()
    state.verify.mockImplementationOnce(async () => {
      second.abort()
    })
    await expect(
      resolveNativePendingTarget(scope, target, 'result', second.signal)
    ).rejects.toThrow()
    expect(state.verify).toHaveBeenCalledOnce()
  })
  it.each(['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'])(
    'refuses reserved root %s while keeping nested business data',
    async (key) => {
      const value = pending()
      state.read.mockResolvedValueOnce(
        page([{ ...value, originalArgs: { ...value.originalArgs, [key]: false } }])
      )
      await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toThrow(
        'Native execution fields'
      )
      expect(state.verify).toHaveBeenCalledOnce()
      expect(() => assertOriginalBusinessArguments({ body: { [key]: false } })).not.toThrow()
      expect(() => assertOriginalBusinessArguments(Object.create({ [key]: null }))).toThrow()
    }
  )
  it('refuses oversized or duplicate/nonmatching-scope pending pages before financial verification', async () => {
    state.read.mockResolvedValueOnce(
      page(
        Array.from({ length: 101 }, (_, index) => ({
          ...pending(),
          target: { ...target, toolCallId: String(index) },
        }))
      )
    )
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 503,
    })
    const other = { ...pending(), target: { ...target, toolCallId: 'other' } }
    state.read
      .mockResolvedValueOnce(page([other], 0, true))
      .mockResolvedValueOnce(page([other, pending()], 1))
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 503,
    })
    state.read.mockResolvedValueOnce(
      page([{ ...pending(), target: { ...target, threadId: 'other-thread' } }])
    )
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 503,
    })
    expect(state.verify).not.toHaveBeenCalled()
  })
})

it('mints own immutable financial source only after actual original acceptance and keeps JSON wire unchanged', async () => {
  const signal = new AbortController().signal
  const reused = pending()
  state.read.mockResolvedValue(page([reused]))
  state.verify.mockResolvedValue({ accepted: true, modelUsd: 'unavailable', appliedUsd: '0.025' })
  const first = await resolveNativePendingTarget(scope, target, 'result', signal)
  const second = await resolveNativePendingTarget(scope, target, 'result', signal)
  expect(first).not.toBe(reused)
  expect(second).not.toBe(first)
  expect(JSON.parse(JSON.stringify(first))).toEqual(reused)
  const source = getNativeFinancialSource(first)
  expect(source?.scope).toEqual(scope)
  expect(source?.binding).toEqual(reused.financialBinding)
  expect(source?.occurrence).toEqual(reused.financialOccurrence)
  expect(source?.signal).toBe(signal)
  expect(Object.isFrozen(source)).toBe(true)
  expect(Object.isFrozen(source?.binding)).toBe(true)
  const context = copyNativeFinancialSource(first, { userId: scope.actorUserId })
  expect(getNativeFinancialSource(context)).toBe(source)
  expect(getNativeFinancialSource(Object.create(context))).toBeUndefined()
  expect(getNativeFinancialSource(JSON.parse(JSON.stringify(first)))).toBeUndefined()
  expect(
    getNativeFinancialSource({ financialSource: source, binding: source?.binding })
  ).toBeUndefined()
  const exact = source?.pendingJson
  reused.originalArgs.changedAfterRead = true
  expect(source?.pendingJson).toBe(exact)
  expect(source?.originalArgsJson).not.toContain('changedAfterRead')
})
