import type Stripe from 'stripe'

const RESTRICTED_PORTAL_POLICY = 'private-tier-grants-v1'

export async function ensureRestrictedBillingPortalConfiguration(stripe: Stripe) {
  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })
  const defaultConfiguration = configurations.data.find((configuration) => configuration.is_default)
  if (!defaultConfiguration) {
    throw new Error('Stripe Billing Portal is not configured')
  }

  if (defaultConfiguration.login_page.enabled) {
    await stripe.billingPortal.configurations.update(defaultConfiguration.id, {
      login_page: { enabled: false },
    })
  }

  const restrictedConfiguration = configurations.data.find(
    (configuration) =>
      configuration.metadata?.tradinggoose_portal_policy === RESTRICTED_PORTAL_POLICY
  )

  if (restrictedConfiguration) {
    if (restrictedConfiguration.features.subscription_update.enabled) {
      await stripe.billingPortal.configurations.update(restrictedConfiguration.id, {
        features: { subscription_update: { enabled: false } },
      })
    }
    return restrictedConfiguration.id
  }

  const configuration = await stripe.billingPortal.configurations.create(
    {
      name: 'TradingGoose restricted plan changes',
      business_profile: {
        headline: defaultConfiguration.business_profile.headline ?? undefined,
        privacy_policy_url: defaultConfiguration.business_profile.privacy_policy_url ?? undefined,
        terms_of_service_url:
          defaultConfiguration.business_profile.terms_of_service_url ?? undefined,
      },
      features: {
        customer_update: defaultConfiguration.features.customer_update,
        invoice_history: defaultConfiguration.features.invoice_history,
        payment_method_update: defaultConfiguration.features.payment_method_update,
        subscription_cancel: defaultConfiguration.features.subscription_cancel,
        subscription_update: { enabled: false },
      },
      metadata: { tradinggoose_portal_policy: RESTRICTED_PORTAL_POLICY },
    },
    { idempotencyKey: 'tradinggoose-private-tier-portal-v1' }
  )

  return configuration.id
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
