import { describe, expect, it } from 'vitest'
import { resolveOrganizationUpgradeReference } from './upgrade-target'

describe('resolveOrganizationUpgradeReference', () => {
  it('uses the explicitly requested organization when the caller owns it', () => {
    expect(
      resolveOrganizationUpgradeReference({
        organizationId: 'org_b',
        organizationAccess: {
          organizations: [
            { id: 'org_a', role: 'owner' },
            { id: 'org_b', role: 'owner' },
          ],
        },
      })
    ).toEqual({ referenceId: 'org_b' })
  })

  it('rejects a requested organization the caller only administers', () => {
    expect(() =>
      resolveOrganizationUpgradeReference({
        organizationId: 'org_admin',
        organizationAccess: {
          organizations: [{ id: 'org_admin', role: 'admin' }],
        },
      })
    ).toThrow('Only the organization owner can manage its subscription.')
  })
})
