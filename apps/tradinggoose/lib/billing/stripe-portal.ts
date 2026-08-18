import type Stripe from 'stripe'
import { getActiveStripeBillingTiers } from '@/lib/billing/tiers'

const MANAGEMENT_CONFIGURATION_METADATA_KEY = 'tradinggoose_purpose'
const MANAGEMENT_CONFIGURATION_METADATA_VALUE = 'billing_management'
const STRIPE_PORTAL_PRODUCT_LIMIT = 10

async function listPortalConfigurations(stripe: Stripe) {
  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })
  const defaultConfiguration = configurations.data.find((configuration) => configuration.is_default)

  if (!defaultConfiguration) {
    throw new Error('Stripe Billing Portal is not configured')
  }

  return { configurations: configurations.data, defaultConfiguration }
}

function normalizeCatalog(
  products: Array<{ product: string; prices: string[] }> | null | undefined
) {
  return (products ?? [])
    .map(({ product, prices }) => ({
      product,
      prices: [...prices].sort(),
    }))
    .sort((left, right) => left.product.localeCompare(right.product))
}

async function getPlanChangeCatalog(stripe: Stripe) {
  const tiers = await getActiveStripeBillingTiers()
  const priceIds = tiers.flatMap((tier) =>
    [tier.stripeMonthlyPriceId, tier.stripeYearlyPriceId].filter((priceId): priceId is string =>
      Boolean(priceId)
    )
  )
  const prices = await Promise.all(priceIds.map((priceId) => stripe.prices.retrieve(priceId)))
  const pricesByProduct = new Map<string, string[]>()

  for (const price of prices) {
    const productId = typeof price.product === 'string' ? price.product : price.product.id
    const productPrices = pricesByProduct.get(productId) ?? []
    productPrices.push(price.id)
    pricesByProduct.set(productId, productPrices)
  }

  const products = Array.from(pricesByProduct, ([product, productPrices]) => ({
    product,
    prices: productPrices,
  }))

  if (products.length > STRIPE_PORTAL_PRODUCT_LIMIT) {
    throw new Error(
      `Stripe Billing Portal supports at most ${STRIPE_PORTAL_PRODUCT_LIMIT} active plan products`
    )
  }

  return normalizeCatalog(products)
}

export async function ensurePlanChangePortalConfiguration(stripe: Stripe) {
  const [{ defaultConfiguration }, products] = await Promise.all([
    listPortalConfigurations(stripe),
    getPlanChangeCatalog(stripe),
  ])
  const subscriptionUpdate = defaultConfiguration.features.subscription_update
  const currentProducts = normalizeCatalog(subscriptionUpdate.products)
  const catalogChanged = JSON.stringify(currentProducts) !== JSON.stringify(products)
  const allowedUpdatesChanged =
    subscriptionUpdate.default_allowed_updates.length !== 1 ||
    subscriptionUpdate.default_allowed_updates[0] !== 'price'

  if (
    defaultConfiguration.login_page.enabled ||
    !subscriptionUpdate.enabled ||
    allowedUpdatesChanged ||
    subscriptionUpdate.proration_behavior !== 'create_prorations' ||
    catalogChanged
  ) {
    await stripe.billingPortal.configurations.update(defaultConfiguration.id, {
      login_page: { enabled: false },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'create_prorations',
          products,
        },
      },
    })
  }

  return defaultConfiguration.id
}

function toBusinessProfile(configuration: Stripe.BillingPortal.Configuration) {
  const profile = configuration.business_profile
  return {
    ...(profile.headline ? { headline: profile.headline } : {}),
    ...(profile.privacy_policy_url ? { privacy_policy_url: profile.privacy_policy_url } : {}),
    ...(profile.terms_of_service_url ? { terms_of_service_url: profile.terms_of_service_url } : {}),
  }
}

async function ensureManagementPortalConfiguration(stripe: Stripe) {
  const { configurations, defaultConfiguration } = await listPortalConfigurations(stripe)
  const managementConfiguration = configurations.find(
    (configuration) =>
      !configuration.is_default &&
      configuration.metadata?.[MANAGEMENT_CONFIGURATION_METADATA_KEY] ===
        MANAGEMENT_CONFIGURATION_METADATA_VALUE
  )

  if (!managementConfiguration) {
    const created = await stripe.billingPortal.configurations.create({
      name: 'TradingGoose billing management',
      business_profile: toBusinessProfile(defaultConfiguration),
      features: {
        ...defaultConfiguration.features,
        subscription_update: { enabled: false },
      },
      login_page: { enabled: false },
      metadata: {
        [MANAGEMENT_CONFIGURATION_METADATA_KEY]: MANAGEMENT_CONFIGURATION_METADATA_VALUE,
      },
    })
    return created.id
  }

  if (
    managementConfiguration.login_page.enabled ||
    managementConfiguration.features.subscription_update.enabled
  ) {
    await stripe.billingPortal.configurations.update(managementConfiguration.id, {
      login_page: { enabled: false },
      features: { subscription_update: { enabled: false } },
    })
  }

  return managementConfiguration.id
}

export async function createBillingManagementPortalSession(
  stripe: Stripe,
  params: Stripe.BillingPortal.SessionCreateParams
) {
  const configuration = await ensureManagementPortalConfiguration(stripe)

  return stripe.billingPortal.sessions.create({
    ...params,
    configuration,
  })
}
