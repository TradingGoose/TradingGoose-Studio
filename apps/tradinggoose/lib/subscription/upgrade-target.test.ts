import { describe, expect, it } from 'vitest'
import { resolveOrganizationUpgradeReference } from './upgrade-target'

describe('resolveOrganizationUpgradeReference', () => {
  it('uses the explicitly requested organization when it is owned by the caller', () => {
    const result = resolveOrganizationUpgradeReference({
      userId: 'user_1',
      organizationId: 'org_b',
      organizationAccess: {
        organizations: [
          { id: 'org_a', role: 'owner' },
          { id: 'org_b', role: 'admin' },
        ],
        isMemberOfAnyOrg: true,
      },
      subscriptions: [],
    })

    expect(result).toEqual({
      referenceId: 'org_b',
      activateOrganizationId: 'org_b',
    })
  })

  it('refuses to guess when the caller can administer multiple organizations and no target is provided', () => {
    expect(() =>
      resolveOrganizationUpgradeReference({
        userId: 'user_1',
        organizationAccess: {
          organizations: [
            { id: 'org_a', role: 'owner' },
            { id: 'org_b', role: 'admin' },
          ],
          isMemberOfAnyOrg: true,
        },
        subscriptions: [],
      })
    ).toThrow(
      'You belong to multiple organizations. Open billing from the organization you want to upgrade and try again.'
    )
  })

  it('falls back to post-checkout organization creation when the caller has no organization membership', () => {
    const result = resolveOrganizationUpgradeReference({
      userId: 'user_1',
      organizationAccess: {
        organizations: [],
        isMemberOfAnyOrg: false,
      },
      subscriptions: [],
    })

    expect(result).toEqual({
      referenceId: 'user_1',
      activateOrganizationId: undefined,
    })
  })

  it('blocks users who are only members of another organization', () => {
    expect(() =>
      resolveOrganizationUpgradeReference({
        userId: 'user_1',
        organizationAccess: {
          organizations: [],
          isMemberOfAnyOrg: true,
        },
        subscriptions: [],
      })
    ).toThrow(
      'You are already a member of an organization. Please leave it or ask an admin to upgrade.'
    )
  })

  it('blocks upgrades into an organization that already has an active subscription', () => {
    expect(() =>
      resolveOrganizationUpgradeReference({
        userId: 'user_1',
        organizationId: 'org_a',
        organizationAccess: {
          organizations: [{ id: 'org_a', role: 'owner' }],
          isMemberOfAnyOrg: true,
        },
        subscriptions: [
          {
            id: 'sub_1',
            status: 'active',
            referenceType: 'organization',
            referenceId: 'org_a',
          },
        ],
      })
    ).toThrow(
      'This organization already has an active subscription. Please manage it from the billing settings.'
    )
  })
})
