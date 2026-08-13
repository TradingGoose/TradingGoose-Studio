import { describe, expect, it } from 'vitest'
import { resolveOrganizationUpgradeReference } from './upgrade-target'

describe('resolveOrganizationUpgradeReference', () => {
  it('uses the explicitly requested organization when the caller can administer it', () => {
    expect(
      resolveOrganizationUpgradeReference({
        organizationId: 'org_b',
        organizationAccess: {
          organizations: [
            { id: 'org_a', role: 'owner' },
            { id: 'org_b', role: 'admin' },
          ],
        },
      })
    ).toEqual({ referenceId: 'org_b' })
  })

  it('rejects a requested organization the caller cannot administer', () => {
    expect(() =>
      resolveOrganizationUpgradeReference({
        organizationId: 'org_member',
        organizationAccess: {
          organizations: [{ id: 'org_member', role: 'member' }],
        },
      })
    ).toThrow('You can only upgrade an organization you own or administer.')
  })
})
