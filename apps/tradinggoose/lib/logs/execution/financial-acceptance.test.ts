/** @vitest-environment node */

import { FinancialPolicyError } from '@tradinggoose/billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  verifyWorkflowFinancialAcceptance,
  type WorkflowFinancialLog,
} from './financial-acceptance'

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: verify }))

const binding = {
  namespace: 'billing-usage:user:original-payer',
  key: 'invocation:execution',
  fingerprint: 'immutable-original-financial-fingerprint',
  runId: 'execution',
  actorUserId: 'actor',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  purpose: 'workflow-execution',
}
const row = (): WorkflowFinancialLog => ({
  id: 'log',
  executionId: 'execution',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  workflowSummary: { id: 'workflow' },
  executionData: {
    environment: {
      userId: 'actor',
      workflowId: 'workflow',
      workspaceId: 'workspace',
      executionId: 'execution',
    },
    billing: { binding: { ...binding } },
  },
})
beforeEach(() => {
  verify.mockReset().mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
})

describe('original workflow base acceptance', () => {
  it('verifies the exact original occurrence and accepts a known zero receipt without settlement', async () => {
    await expect(verifyWorkflowFinancialAcceptance(row())).resolves.toEqual({
      accepted: true,
      appliedUsd: '0',
      modelUsd: 'unavailable',
    })
    expect(verify).toHaveBeenCalledExactlyOnceWith(binding, {
      stepNumber: 0,
      retryCount: 0,
      runId: 'execution',
    })
  })
  it('retains original workflow ownership when the workflow has been deleted', async () => {
    const log = row()
    log.workflowId = null
    await verifyWorkflowFinancialAcceptance(log)
    expect(verify).toHaveBeenCalledExactlyOnceWith(binding, expect.anything())
  })
  it.each([
    'missing',
    'purpose',
    'key',
    'runId',
    'workspaceId',
    'workflowId',
    'actorUserId',
    'fingerprint',
  ])(
    'rejects missing or conflicting original binding %s before querying acceptance',
    async (field) => {
      const log = row()
      const data = log.executionData as any
      if (field === 'missing') data.billing = {}
      else data.billing.binding[field] = field === 'fingerprint' ? '' : 'wrong'
      await expect(verifyWorkflowFinancialAcceptance(log)).rejects.toBeInstanceOf(
        FinancialPolicyError
      )
      expect(verify).not.toHaveBeenCalled()
    }
  )
  it.each(['userId', 'workspaceId', 'workflowId', 'executionId'])(
    'rejects conflicting original environment %s before querying acceptance',
    async (field) => {
      const log = row()
      ;(log.executionData as any).environment[field] = 'wrong'
      await expect(verifyWorkflowFinancialAcceptance(log)).rejects.toBeInstanceOf(
        FinancialPolicyError
      )
      expect(verify).not.toHaveBeenCalled()
    }
  )
  it('does not replace absent, unaccepted, or conflicting canonical financial proof with preserved output', async () => {
    const log = row()
    ;(log.executionData as any).finalOutput = { completedWork: true }
    verify.mockRejectedValueOnce(new FinancialPolicyError('Financial acceptance is unresolved'))
    await expect(verifyWorkflowFinancialAcceptance(log)).rejects.toThrow(
      'Financial acceptance is unresolved'
    )
    expect((log.executionData as any).finalOutput).toEqual({ completedWork: true })
  })
})
