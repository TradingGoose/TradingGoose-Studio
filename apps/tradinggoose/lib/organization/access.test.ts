import { describe, expect, it } from 'vitest'
import { getOrganizationAccessState } from './access'

describe('getOrganizationAccessState', () => {
  it('hides organization creation when billing is disabled', () => {
    expect(
      getOrganizationAccessState({
        billingEnabled: false,
        hasOrganization: false,
        isOrganizationAdmin: false,
      })
    ).toMatchObject({
      canCreateOrganization: false,
      canOpenTeamSettings: false,
    })
  })

  it('allows a bare organization shell when billing is enabled', () => {
    expect(
      getOrganizationAccessState({
        billingEnabled: true,
        hasOrganization: false,
        isOrganizationAdmin: false,
      })
    ).toMatchObject({
      canCreateOrganization: true,
      canOpenTeamSettings: true,
    })
  })

  it('gates SSO by organization admin role, and only uses tier access when billing is enabled', () => {
    expect(
      getOrganizationAccessState({
        billingEnabled: true,
        hasOrganization: true,
        isOrganizationAdmin: true,
        organizationTier: {
          ownerType: 'organization',
          canConfigureSso: true,
        },
      }).canConfigureSso
    ).toBe(true)

    expect(
      getOrganizationAccessState({
        billingEnabled: true,
        hasOrganization: true,
        isOrganizationAdmin: true,
        organizationTier: {
          ownerType: 'organization',
          canConfigureSso: false,
        },
      }).canConfigureSso
    ).toBe(false)

    expect(
      getOrganizationAccessState({
        billingEnabled: false,
        hasOrganization: true,
        isOrganizationAdmin: true,
      }).canConfigureSso
    ).toBe(true)

    expect(
      getOrganizationAccessState({
        billingEnabled: false,
        hasOrganization: true,
        isOrganizationAdmin: false,
      }).canConfigureSso
    ).toBe(false)
  })
})
