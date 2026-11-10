import { describe, expect, it } from 'bun:test'
import {
  dispatchBackoff,
  type FinancialBinding,
  financialFingerprint,
  financialNamespace,
  monetary,
  occurrenceKey,
  projectDispatch,
  remainingOverage,
} from './index'

const binding: FinancialBinding = {
  namespace: 'billing-usage:user:payer',
  key: 'invocation:server-key',
  fingerprint: 'trusted-fingerprint',
  runId: 'native-run',
  actorUserId: 'member',
  workspaceId: 'workspace',
  workflowId: null,
  purpose: 'copilot',
}
const basis = {
  acceptedUsd: '30',
  copilotUsd: '4',
  issuedUsd: '0',
  pendingUsd: '0',
  memberUsd: { a: '30', b: '5' },
}
describe('original financial identity and live entitlement', () => {
  it('keeps cumulative usage and recomputes live allowance without repricing', () => {
    expect(remainingOverage(basis, '20', 'user')).toBe('10')
    expect(remainingOverage(basis, '40', 'user')).toBe('0')
    expect(basis.acceptedUsd).toBe('30')
  })
  it('preserves accepted pending and issued commitments after allowance increases', () => {
    expect(remainingOverage({ ...basis, pendingUsd: '10' }, '40', 'user')).toBe('0')
    expect(remainingOverage({ ...basis, acceptedUsd: '55', pendingUsd: '10' }, '40', 'user')).toBe(
      '5'
    )
    expect(remainingOverage({ ...basis, acceptedUsd: '55', issuedUsd: '10' }, '40', 'user')).toBe(
      '5'
    )
  })
  it('does not pool individual member allowances or erase departed members', () => {
    expect(remainingOverage(basis, '20', 'individual')).toBe('10')
    expect(remainingOverage(basis, '40', 'individual')).toBe('0')
    expect(remainingOverage(basis, '40', 'pooled')).toBe('0')
  })
  it('uses persisted run counters without requiring optional native runId', () => {
    expect(occurrenceKey(binding, { stepNumber: 0, retryCount: 0 })).toBe(
      occurrenceKey(binding, { stepNumber: 0, retryCount: 0, runId: binding.runId })
    )
    expect(() =>
      occurrenceKey(binding, { stepNumber: 0, retryCount: 0, runId: 'forged' })
    ).toThrow()
    expect(() => occurrenceKey(binding, { stepNumber: -1, retryCount: 0 })).toThrow()
    expect(occurrenceKey(binding, { stepNumber: 0, retryCount: 1 })).not.toBe(
      occurrenceKey(binding, { stepNumber: 0, retryCount: 0 })
    )
  })
  it('rejects unavailable, negative, malformed and underflowed money', () => {
    for (const value of [
      null,
      undefined,
      '',
      ' ',
      -1,
      '-1e-999',
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(() => monetary(value)).toThrow()
    expect(monetary('0')).toBe('0')
  })
  it('pins root namespaces and stable fingerprints independently of JSON key order', () => {
    expect(financialNamespace({ type: 'organization', id: 'original' })).toBe(
      'billing-usage:organization:original'
    )
    expect(financialFingerprint({ payer: 'a', quote: 8 })).toBe(
      financialFingerprint({ quote: 8, payer: 'a' })
    )
  })
})
describe('durable dispatch projections', () => {
  it('retains expired claims and unknown contact as due financial obligations', () => {
    const receipt = projectDispatch({
      financialClosureState: 'closed' as const,
      dispatchState: 'complete' as const,
      dispatchAtMs: 0,
      markers: [
        {
          id: 'head',
          kind: 'invoice' as const,
          phase: 'create',
          state: 'claimed' as const,
          attempts: 1,
          failedAttempts: 0,
          nextAtMs: 1,
          claimExpiresAtMs: 120_000,
        },
      ],
    })
    expect(receipt.dispatchState).toBe('pending')
    expect(receipt.dispatchAtMs).toBe(120_000)
    expect(receipt.financialClosureState).toBe('open')
  })
  it('never expires repeated failed obligations', () => {
    expect(dispatchBackoff({ id: 'head', attempts: 8 }, 50)).toBe(900_050)
    expect(dispatchBackoff({ id: 'head', attempts: 100 }, 50)).toBe(900_050)
    const retry = dispatchBackoff({ id: 'head', attempts: 1 }, 0)
    expect(retry).toBeGreaterThanOrEqual(60_000)
    expect(retry).toBeLessThan(70_000)
  })
})
