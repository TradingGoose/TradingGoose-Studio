import { canTierConfigureSso } from '@/lib/billing/tier-summary'

type OrganizationAccessTier = {
  ownerType?: 'user' | 'organization' | null
  canConfigureSso?: boolean | null
}

export function canTierCreateOrganization(
  tier: OrganizationAccessTier | null | undefined
): boolean {
  return tier?.ownerType === 'organization'
}

export function getOrganizationAccessState(input: {
  billingEnabled: boolean
  hasOrganization: boolean
  isOrganizationAdmin: boolean
  userTier?: OrganizationAccessTier | null
  organizationTier?: OrganizationAccessTier | null
}) {
  const canUseTierGatedOrganizationAccess =
    !input.billingEnabled || canTierCreateOrganization(input.userTier)
  const requiresOrganizationUpgrade =
    !input.hasOrganization && input.billingEnabled && !canUseTierGatedOrganizationAccess
  const canCreateOrganization = !input.hasOrganization && canUseTierGatedOrganizationAccess
  const canUseTierGatedSso =
    !input.billingEnabled ||
    (canTierCreateOrganization(input.organizationTier) &&
      canTierConfigureSso(input.organizationTier))

  return {
    canCreateOrganization,
    canOpenTeamSettings:
      input.hasOrganization || canCreateOrganization || requiresOrganizationUpgrade,
    canManageOrganization: input.hasOrganization && input.isOrganizationAdmin,
    canConfigureSso:
      input.hasOrganization && input.isOrganizationAdmin && canUseTierGatedSso,
    requiresOrganizationUpgrade,
  }
}
