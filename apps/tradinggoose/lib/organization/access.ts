import { canTierConfigureSso } from '@/lib/billing/tier-summary'

type OrganizationAccessTier = {
  ownerType?: 'user' | 'organization' | null
  canConfigureSso?: boolean | null
}

function isOrganizationTier(tier: OrganizationAccessTier | null | undefined): boolean {
  return tier?.ownerType === 'organization'
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
    (!input.billingEnabled ||
      (isOrganizationTier(input.organizationTier) && canTierConfigureSso(input.organizationTier)))

  return {
    canCreateOrganization,
    canOpenTeamSettings: input.hasOrganization || canCreateOrganization,
    canManageOrganization: input.hasOrganization && input.isOrganizationAdmin,
    canConfigureSso,
  }
}
