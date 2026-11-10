/** @vitest-environment node */
import {
  type FinancialBinding,
  financialFingerprint,
  type ModelOccurrence,
  type OperationReceipt,
  occurrenceKey,
} from '@tradinggoose/billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptFinancialModelStep,
  createFinancialInvocation,
  verifyFinancialAcceptance,
} from './native-finance'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  accept: vi.fn(),
  verify: vi.fn(),
  create: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { transaction: mocks.transaction } }))
vi.mock('@tradinggoose/billing', async (original) => ({
  ...(await original<typeof import('@tradinggoose/billing')>()),
  createInvocation: mocks.create,
  acceptModelStep: mocks.accept,
  verifyAcceptance: mocks.verify,
}))
const binding: FinancialBinding = {
  namespace: 'billing-usage:user:actor',
  key: 'invocation:original',
  fingerprint: 'original',
  runId: 'run',
  actorUserId: 'actor',
  workspaceId: null,
  workflowId: null,
  purpose: 'copilot',
}
const occurrence = { runId: 'run', stepNumber: 0, retryCount: 0 }
function receipt(step: ModelOccurrence = occurrence): OperationReceipt {
  return {
    recordType: 'operation',
    fingerprint: financialFingerprint([binding.fingerprint, occurrenceKey(binding, step)]),
    binding: { ...binding },
    identity: {
      root: { type: 'user', id: 'actor' },
      actorUserId: 'actor',
      memberUserId: null,
      scope: 'user',
      period: null,
      billingEnabled: true,
      quote: {
        holdUsd: '1',
        multiplier: '1',
        modelUsd: 'unavailable',
        baseChargeUsd: '0',
        defaultGrant: false,
        billable: true,
      },
      workspaceId: null,
      workflowId: null,
      purpose: 'copilot',
    },
    holdState: 'closed',
    contactState: 'accepted',
    appliedUsd: '0.30000000000000001',
    modelUsd: 'unavailable',
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: 1,
    markers: [],
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tx = { fixture: true }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.accept.mockResolvedValue(receipt())
  mocks.transaction.mockImplementation(async (callback) => callback(tx))
})

describe('canonical model acceptance transaction acknowledgement', () => {
  it('returns the exact resolved receipt with exact money and preserves actual usage without another read', async () => {
    const canonical = receipt()
    const usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
    mocks.accept.mockResolvedValue(canonical)
    expect(await acceptFinancialModelStep(binding, { ...occurrence, usage })).toBe(canonical)
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(
      tx,
      binding,
      { ...occurrence, usage },
      { usage }
    )
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(canonical.financialClosureState).toBe('open')
    expect(canonical.dispatchState).toBe('pending')
  })
  it.each([
    ['missing', undefined],
    ['null', null],
    ['different record', { recordType: 'invocation' }],
    ['uncertain contact', { contactState: 'uncertain' }],
    ['open hold', { holdState: 'outstanding' }],
    ['missing amount', { appliedUsd: undefined }],
    ['numeric amount', { appliedUsd: 0.3 }],
    ['noncanonical amount', { appliedUsd: '0.30' }],
    ['negative amount', { appliedUsd: '-1' }],
    ['malformed amount', { appliedUsd: 'unknown' }],
    ['wrong original fingerprint', { binding: { ...binding, fingerprint: 'other' } }],
    ['wrong original scope', { binding: { ...binding, workspaceId: 'other' } }],
    ['wrong occurrence', { fingerprint: receipt({ ...occurrence, stepNumber: 1 }).fingerprint }],
    ['missing binding', { binding: undefined }],
  ] as const)('refuses %s without promoting or repeating acceptance', async (_label, patch) => {
    mocks.accept.mockResolvedValue(patch == null ? patch : { ...receipt(), ...patch })
    await expect(acceptFinancialModelStep(binding, occurrence)).rejects.toThrow()
    expect(mocks.accept).toHaveBeenCalledOnce()
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('waits for the outer acknowledgement after the in-transaction receipt resolves', async () => {
    const acknowledgement = deferred<void>()
    const canonical = receipt()
    mocks.accept.mockResolvedValue(canonical)
    mocks.transaction.mockImplementation(async (callback) => {
      const value = await callback(tx)
      await acknowledgement.promise
      return value
    })
    let acknowledged = false
    const result = acceptFinancialModelStep(binding, occurrence).then((value) => {
      acknowledged = true
      return value
    })
    await vi.waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce())
    expect(acknowledged).toBe(false)
    acknowledgement.resolve()
    expect(await result).toBe(canonical)
  })
  it('does not claim acknowledgement when a simulated commit loses its acknowledgement', async () => {
    const lost = new Error('commit outcome unknown')
    mocks.transaction.mockImplementation(async (callback) => {
      await callback(tx)
      throw lost
    })
    await expect(acceptFinancialModelStep(binding, occurrence)).rejects.toBe(lost)
    expect(mocks.accept).toHaveBeenCalledOnce()
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('preserves a transaction refusal before acceptance', async () => {
    const refusal = new Error('transaction refused')
    mocks.transaction.mockRejectedValue(refusal)
    await expect(acceptFinancialModelStep(binding, occurrence)).rejects.toBe(refusal)
    expect(mocks.accept).not.toHaveBeenCalled()
  })
  it('pins original binding and occurrence before awaiting transaction work', async () => {
    const originalBinding = { ...binding }
    const originalOccurrence = { ...occurrence }
    const completion = deferred<OperationReceipt>()
    mocks.accept.mockReturnValue(completion.promise)
    const result = acceptFinancialModelStep(originalBinding, originalOccurrence)
    originalBinding.workspaceId = 'mutated'
    originalBinding.fingerprint = 'mutated'
    originalOccurrence.stepNumber = 99
    completion.resolve(receipt())
    await expect(result).resolves.toEqual(receipt())
    expect(mocks.accept).toHaveBeenCalledWith(tx, binding, occurrence, { usage: undefined })
  })
  it('retains the distinct later canonical acceptance read boundary', async () => {
    const fact = { accepted: true, modelUsd: 'unavailable', appliedUsd: '0.30000000000000001' }
    mocks.verify.mockResolvedValue(fact)
    expect(await verifyFinancialAcceptance(binding, occurrence)).toBe(fact)
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(tx, binding, occurrence)
    expect(mocks.accept).not.toHaveBeenCalled()
  })
})

it('checks server-owned child namespace inside the SAME creation transaction and strips its helper field', async () => {
  const child = { ...binding, purpose: 'embedding', runId: 'stable-child' }
  mocks.create.mockResolvedValue(child)
  expect(
    await createFinancialInvocation({
      actorUserId: binding.actorUserId,
      runId: child.runId,
      purpose: 'embedding',
      operationKey: 'stable-child',
      expectedNamespace: binding.namespace,
    })
  ).toBe(child)
  const [actualTx, input] = mocks.create.mock.calls[0]
  expect(actualTx).toBe(tx)
  expect(input).toMatchObject({
    actorUserId: binding.actorUserId,
    runId: 'stable-child',
    purpose: 'embedding',
    operationKey: 'stable-child',
  })
  expect(input).not.toHaveProperty('expectedNamespace')
  expect(mocks.transaction).toHaveBeenCalledOnce()
})
it('rolls back mismatched child owner before any admission and never changes the original binding', async () => {
  const original = { ...binding }
  mocks.create.mockResolvedValue({
    ...binding,
    namespace: 'billing-usage:user:new-owner',
    purpose: 'embedding',
  })
  let committed = false
  let rolledBack = false
  mocks.transaction.mockImplementation(async (callback) => {
    try {
      const value = await callback(tx)
      committed = true
      return value
    } catch (error) {
      rolledBack = true
      throw error
    }
  })
  await expect(
    createFinancialInvocation({
      actorUserId: binding.actorUserId,
      runId: 'stable-child',
      purpose: 'embedding',
      expectedNamespace: binding.namespace,
    })
  ).rejects.toMatchObject({ status: 403 })
  expect(committed).toBe(false)
  expect(rolledBack).toBe(true)
  expect(binding).toEqual(original)
  expect(mocks.accept).not.toHaveBeenCalled()
})
