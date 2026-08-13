import type Stripe from 'stripe'

export async function ensureRestrictedBillingPortalConfiguration(stripe: Stripe) {
  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })
  const defaultConfiguration = configurations.data.find((configuration) => configuration.is_default)
  if (!defaultConfiguration) {
    throw new Error('Stripe Billing Portal is not configured')
  }

  if (
    defaultConfiguration.login_page.enabled ||
    defaultConfiguration.features.subscription_update.enabled
  ) {
    await stripe.billingPortal.configurations.update(defaultConfiguration.id, {
      ...(defaultConfiguration.login_page.enabled ? { login_page: { enabled: false } } : {}),
      ...(defaultConfiguration.features.subscription_update.enabled
        ? { features: { subscription_update: { enabled: false } } }
        : {}),
    })
  }

  return defaultConfiguration.id
}

export async function createRestrictedBillingPortalSession(
  stripe: Stripe,
  params: Stripe.BillingPortal.SessionCreateParams
) {
  const configuration = await ensureRestrictedBillingPortalConfiguration(stripe)

  return stripe.billingPortal.sessions.create({
    ...params,
    configuration,
  })
}
