import { describe, expect, it } from 'bun:test'
import { FinancialPolicyError, financialFingerprint, financialNamespace } from './index'
import {
  type MemberRegistrationReceipt,
  type MemberRegistryReceipt,
  memberRegistrationKey,
  memberRegistryKey,
  validateFinancialMemberReceipt,
} from './members'

const root = { type: 'organization' as const, id: 'original-org' }
const userId = 'original-user'
const actualMembershipId = 'original-member'
const namespace = financialNamespace(root)
const observedAt = '2026-11-09T00:00:00.000Z'
const ledgerAnchor = financialFingerprint({ organizationId: root.id, userId })

function liveRegistry(): MemberRegistryReceipt {
  return {
    recordType: 'member-registry',
    version: 1,
    root: { ...root },
    financialClosureState: 'closed',
    provenance: {
      kind: 'live-root-creation',
      reference: `organization:${root.id}`,
      digest: financialFingerprint({ root, creation: 'actual-organization-insert', baseline: [] }),
      observedAt,
    },
  }
}

function livePair(): MemberRegistrationReceipt {
  return {
    ...liveRegistry(),
    recordType: 'member-registration',
    userId,
    ledgerAnchor,
    provenance: {
      kind: 'live-membership-registration',
      reference: `member:${actualMembershipId}`,
      digest: financialFingerprint({ root, userId, ledgerAnchor, actualMembershipId }),
      observedAt,
    },
  }
}

// Deliberately malformed persisted JSON crosses the same typed receipt boundary as readback.
function validateUnknown(receipt: unknown, key: string, targetNamespace = namespace) {
  validateFinancialMemberReceipt(
    receipt as MemberRegistryReceipt | MemberRegistrationReceipt,
    targetNamespace,
    key
  )
}

describe('original member provenance receipt validation', () => {
  it('pins the genuine creation, original pair and membership digest vectors', () => {
    expect(ledgerAnchor).toBe('6b72625f048d656e49a72416f330ae065308d9cac81b6bd5e4f07321717b55f7')
    expect(liveRegistry().provenance.digest).toBe(
      '8c5203bab322edb2085d7d1fae3464e72dc6b3a16f3623bc3ca884441826dae4'
    )
    expect(livePair().provenance.digest).toBe(
      '72b813893ceb5426f64fd91206d21ab1c4ce804c9c2fbe48add4ff85b5ac6866'
    )
    expect(
      financialFingerprint({
        actualMembershipId,
        ledgerAnchor,
        userId,
        root: { id: root.id, type: root.type },
      })
    ).toBe(livePair().provenance.digest)
    expect(financialFingerprint({ registryDigest: 'a'.repeat(64), userId, ledgerAnchor })).toBe(
      '2c24a5d18c4939dc3a632c520828e2177163e22cf2c357f6a99ae43c0e10c278'
    )
  })

  it('accepts genuine closed creation and membership records without changing their evidence', () => {
    const registry = liveRegistry()
    const pair = livePair()
    const before = JSON.stringify({ registry, pair })
    expect(() => validateUnknown(registry, memberRegistryKey)).not.toThrow()
    expect(() => validateUnknown(pair, memberRegistrationKey(userId))).not.toThrow()
    expect(JSON.stringify({ registry, pair })).toBe(before)
  })

  it('binds creation to the original organization reference and actual-insertion digest', () => {
    const receipt = liveRegistry()
    for (const reference of ['organization:another-org', 'member:original-org', 'organization:'])
      expect(() =>
        validateUnknown(
          { ...receipt, provenance: { ...receipt.provenance, reference } },
          memberRegistryKey
        )
      ).toThrow(FinancialPolicyError)
    for (const digest of [
      'a'.repeat(64),
      financialFingerprint({ root, creation: 'caller-returned-id', baseline: [] }),
      financialFingerprint({
        root: { ...root, id: 'another-org' },
        creation: 'actual-organization-insert',
        baseline: [],
      }),
    ])
      expect(() =>
        validateUnknown(
          { ...receipt, provenance: { ...receipt.provenance, digest } },
          memberRegistryKey
        )
      ).toThrow(FinancialPolicyError)
  })

  it('requires a nonempty actual membership reference with its original insertion digest', () => {
    const receipt = livePair()
    for (const reference of ['member:', 'member:replacement-member', 'organization:original-org'])
      expect(() =>
        validateUnknown(
          { ...receipt, provenance: { ...receipt.provenance, reference } },
          memberRegistrationKey(userId)
        )
      ).toThrow(FinancialPolicyError)
    for (const digest of [
      'a'.repeat(64),
      financialFingerprint({
        root,
        userId,
        ledgerAnchor,
        actualMembershipId: 'replacement-member',
      }),
      financialFingerprint({ root, userId: 'another-user', ledgerAnchor, actualMembershipId }),
      financialFingerprint({ root, userId, ledgerAnchor: 'a'.repeat(64), actualMembershipId }),
    ])
      expect(() =>
        validateUnknown(
          { ...receipt, provenance: { ...receipt.provenance, digest } },
          memberRegistrationKey(userId)
        )
      ).toThrow(FinancialPolicyError)
  })

  it('refuses another namespace, record key, root or original member ledger anchor', () => {
    const registry = liveRegistry()
    const pair = livePair()
    expect(() =>
      validateUnknown(registry, memberRegistryKey, 'billing-usage:organization:another-org')
    ).toThrow(FinancialPolicyError)
    expect(() => validateUnknown(registry, memberRegistrationKey(userId))).toThrow(
      FinancialPolicyError
    )
    expect(() => validateUnknown(pair, memberRegistryKey)).toThrow(FinancialPolicyError)
    expect(() => validateUnknown(pair, memberRegistrationKey('another-user'))).toThrow(
      FinancialPolicyError
    )
    for (const originalRoot of [null, { type: 'user', id: root.id }, { ...root, id: '' }])
      expect(() => validateUnknown({ ...registry, root: originalRoot }, memberRegistryKey)).toThrow(
        FinancialPolicyError
      )
    for (const anchor of [
      '',
      'a'.repeat(64),
      financialFingerprint({ organizationId: root.id, userId: 'another-user' }),
    ])
      expect(() =>
        validateUnknown({ ...pair, ledgerAnchor: anchor }, memberRegistrationKey(userId))
      ).toThrow(FinancialPolicyError)
  })

  it('refuses open or absent closure, malformed digest and noncanonical observation time', () => {
    for (const receipt of [liveRegistry(), livePair()]) {
      const key =
        receipt.recordType === 'member-registry' ? memberRegistryKey : memberRegistrationKey(userId)
      for (const financialClosureState of ['open', null, undefined])
        expect(() => validateUnknown({ ...receipt, financialClosureState }, key)).toThrow(
          FinancialPolicyError
        )
      for (const digest of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)])
        expect(() =>
          validateUnknown({ ...receipt, provenance: { ...receipt.provenance, digest } }, key)
        ).toThrow(FinancialPolicyError)
      for (const value of [
        '',
        'not-a-date',
        '2026-11-09T00:00:00Z',
        '2026-11-09T01:00:00.000+01:00',
      ])
        expect(() =>
          validateUnknown(
            { ...receipt, provenance: { ...receipt.provenance, observedAt: value } },
            key
          )
        ).toThrow(FinancialPolicyError)
    }
  })

  it('refuses mixed live provenance kinds and unsupported receipt versions', () => {
    expect(() =>
      validateUnknown({ ...liveRegistry(), provenance: livePair().provenance }, memberRegistryKey)
    ).toThrow(FinancialPolicyError)
    expect(() =>
      validateUnknown(
        { ...livePair(), provenance: liveRegistry().provenance },
        memberRegistrationKey(userId)
      )
    ).toThrow(FinancialPolicyError)
    for (const version of [0, 2, '1', null])
      expect(() => validateUnknown({ ...liveRegistry(), version }, memberRegistryKey)).toThrow(
        FinancialPolicyError
      )
  })

  it('retains verified-preservation receipt shape without pretending it proves live insertion', () => {
    const registry = liveRegistry()
    registry.provenance = {
      kind: 'verified-preservation',
      reference: 'offline:verified-source',
      digest: 'a'.repeat(64),
      observedAt,
    }
    const pair = livePair()
    pair.provenance = {
      kind: 'verified-preservation',
      reference: registry.provenance.reference,
      digest: financialFingerprint({
        registryDigest: registry.provenance.digest,
        userId,
        ledgerAnchor,
      }),
      observedAt,
    }
    expect(() => validateUnknown(registry, memberRegistryKey)).not.toThrow()
    expect(() => validateUnknown(pair, memberRegistrationKey(userId))).not.toThrow()
    expect(() =>
      validateUnknown({ ...pair, ledgerAnchor: 'a'.repeat(64) }, memberRegistrationKey(userId))
    ).toThrow(FinancialPolicyError)
  })
})
