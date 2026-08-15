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
    (organization) => organization.id === input.organizationId && organization.role === 'owner'
  )

  if (!selectedOrganization) {
    throw new Error('Only the organization owner can manage its subscription.')
  }

  return { referenceId: selectedOrganization.id }
}
