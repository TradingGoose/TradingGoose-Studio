type OrganizationUpgradeAccess = {
  organizations?: Array<{
    id: string
    role?: string | null
  }>
  isMemberOfAnyOrg?: boolean
}

type OrganizationUpgradeSubscription = {
  id?: string | null
  status?: string | null
  referenceId?: string | null
  referenceType?: string | null
}

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due'])

function isEntitledOrganizationSubscription(
  subscription: OrganizationUpgradeSubscription,
  organizationId: string
) {
  return (
    typeof subscription.status === 'string' &&
    ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status) &&
    subscription.referenceType === 'organization' &&
    subscription.referenceId === organizationId
  )
}

function assertOrganizationHasNoActiveSubscription(
  subscriptions: OrganizationUpgradeSubscription[],
  organizationId: string
) {
  const existingOrganizationSubscription = subscriptions.find((subscription) =>
    isEntitledOrganizationSubscription(subscription, organizationId)
  )

  if (existingOrganizationSubscription) {
    throw new Error(
      'This organization already has an active subscription. Please manage it from the billing settings.'
    )
  }
}

export function resolveOrganizationUpgradeReference(input: {
  userId: string
  organizationId?: string
  organizationAccess: OrganizationUpgradeAccess
  subscriptions: OrganizationUpgradeSubscription[]
}) {
  const eligibleOrganizations = (input.organizationAccess.organizations ?? []).filter(
    (organization) => organization.role === 'owner' || organization.role === 'admin'
  )

  if (input.organizationId) {
    const selectedOrganization = eligibleOrganizations.find(
      (organization) => organization.id === input.organizationId
    )

    if (!selectedOrganization) {
      throw new Error('You can only upgrade an organization you own or administer.')
    }

    assertOrganizationHasNoActiveSubscription(input.subscriptions, selectedOrganization.id)

    return {
      referenceId: selectedOrganization.id,
      activateOrganizationId: selectedOrganization.id,
    }
  }

  if (eligibleOrganizations.length > 1) {
    throw new Error(
      'You belong to multiple organizations. Open billing from the organization you want to upgrade and try again.'
    )
  }

  if (eligibleOrganizations.length === 1) {
    const [selectedOrganization] = eligibleOrganizations

    assertOrganizationHasNoActiveSubscription(input.subscriptions, selectedOrganization.id)

    return {
      referenceId: selectedOrganization.id,
      activateOrganizationId: selectedOrganization.id,
    }
  }

  if (input.organizationAccess.isMemberOfAnyOrg) {
    throw new Error(
      'You are already a member of an organization. Please leave it or ask an admin to upgrade.'
    )
  }

  return {
    referenceId: input.userId,
    activateOrganizationId: undefined,
  }
}
