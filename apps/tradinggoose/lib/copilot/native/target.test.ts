import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scope, Target } from './contract'
import { nativeConversationIdentity } from './identity'
import type { ServerPending as Pending } from './target'

const state = vi.hoisted(() => ({ list: vi.fn(), verify: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/copilot/agent/service', () => ({ listCopilotPending: state.list }))
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
  runId: 'run',
  toolCallId: 'call',
  toolName: 'read_workflow',
}
const pending = (): Pending => ({
  target,
  stage: 'result',
  originalArgs: { entityId: 'workflow' },
  financialBinding: {
    namespace: 'payer',
    key: 'invocation',
    fingerprint: 'fingerprint',
    actorUserId: 'actor',
    workspaceId: null,
    workflowId: null,
    runId: 'run',
    purpose: 'copilot',
  },
  financialOccurrence: { stepNumber: 3, retryCount: 0, runId: 'run' },
})
beforeEach(() => {
  vi.clearAllMocks()
  state.list.mockResolvedValue([pending()])
  state.verify.mockResolvedValue({ appliedUsd: '0' })
  state.access.mockResolvedValue({ hasAccess: true })
})
describe('local native pending authorization', () => {
  it('discovers pending from local snapshots and verifies original accounting', async () => {
    const result = await resolveNativePendingTarget(scope, target, 'result')
    expect(state.list).toHaveBeenCalledWith(scope, 'thread', undefined)
    expect(state.verify).toHaveBeenCalledWith(
      pending().financialBinding,
      pending().financialOccurrence
    )
    expect(result).toEqual(pending())
    expect(getNativeFinancialSource(result)?.scope).toEqual(scope)
  })
  it('rejects foreign resources before discovery', async () => {
    await expect(
      resolveNativePendingTarget(scope, { ...target, resourceId: 'foreign' }, 'result')
    ).rejects.toMatchObject({ status: 403 })
    expect(state.list).not.toHaveBeenCalled()
  })
  it('rejects missing or stale-stage targets', async () => {
    state.list.mockResolvedValue([])
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 409,
    })
    state.list.mockResolvedValue([{ ...pending(), stage: 'approval' }])
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 409,
    })
  })
  it.each(['actorUserId', 'workspaceId', 'runId', 'purpose'] as const)(
    'rejects changed original financial %s',
    async (key) => {
      const item = pending()
      item.financialBinding[key] = 'foreign'
      state.list.mockResolvedValue([item])
      await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
        status: 403,
      })
      expect(state.verify).not.toHaveBeenCalled()
    }
  )
  it('rechecks current workspace membership', async () => {
    state.access.mockResolvedValue({ hasAccess: false })
    await expect(authorizeNativeConversationScope('actor', 'revoked')).rejects.toMatchObject({
      status: 403,
    })
  })
  it('mints non-JSON provenance and never trusts structural lookalikes', async () => {
    const signal = new AbortController().signal
    const result = await resolveNativePendingTarget(scope, target, 'result', signal)
    expect(getNativeFinancialSource(JSON.parse(JSON.stringify(result)))).toBeUndefined()
    const context = {}
    copyNativeFinancialSource(result, context)
    expect(getNativeFinancialSource(context)?.signal).toBe(signal)
    expect(
      getNativeFinancialSource({ scope, target, binding: pending().financialBinding })
    ).toBeUndefined()
  })
  it.each(['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'])(
    'rejects model execution field %s',
    (key) => {
      expect(() => assertOriginalBusinessArguments({ [key]: true })).toThrow()
    }
  )
})
