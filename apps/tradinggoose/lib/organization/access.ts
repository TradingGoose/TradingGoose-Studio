import { canTierConfigureSso } from '@/lib/billing/tier-summary'

type OrganizationAccessTier = {
  ownerType?: 'user' | 'organization' | null
  canConfigureSso?: boolean | null
}

export function isOrganizationSsoEnabled(
  billingEnabled: boolean,
  tier: OrganizationAccessTier | null | undefined
) {
  return !billingEnabled || (tier?.ownerType === 'organization' && canTierConfigureSso(tier))
}

export function getOrganizationAccessState(input: {
  billingEnabled: boolean
  hasOrganization: boolean
  isOrganizationAdmin: boolean
  organizationTier?: OrganizationAccessTier | null
}) {
  const canCreateOrganization = !input.hasOrganization && input.billingEnabled
  const canConfigureSso =
    input.hasOrganization &&
    input.isOrganizationAdmin &&
    isOrganizationSsoEnabled(input.billingEnabled, input.organizationTier)

  return {
    canCreateOrganization,
    canOpenTeamSettings: input.hasOrganization || canCreateOrganization,
    canManageOrganization: input.hasOrganization && input.isOrganizationAdmin,
    canConfigureSso,
  }
}
