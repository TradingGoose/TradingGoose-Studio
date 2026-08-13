type OrganizationUpgradeAccess = {
  organizations?: Array<{
    id: string
    role?: string | null
  }>
}

export function resolveOrganizationUpgradeReference(input: {
  organizationId: string
  organizationAccess: OrganizationUpgradeAccess
}) {
  const selectedOrganization = input.organizationAccess.organizations?.find(
    (organization) =>
      organization.id === input.organizationId &&
      (organization.role === 'owner' || organization.role === 'admin')
  )

  if (!selectedOrganization) {
    throw new Error('You can only upgrade an organization you own or administer.')
  }

  return { referenceId: selectedOrganization.id }
}
