import type Stripe from 'stripe'
import { type BillingTierRecord, getActiveStripeBillingTiers } from '@/lib/billing/tiers'

const MANAGEMENT_CONFIGURATION_METADATA_KEY = 'tradinggoose_purpose'
const MANAGEMENT_CONFIGURATION_METADATA_VALUE = 'billing_management'
const MANAGEMENT_CONFIGURATION_IDEMPOTENCY_KEY = 'billing-portal:management-configuration'
const STRIPE_PORTAL_PRODUCT_LIMIT = 10
const PLAN_CHANGE_ALLOWED_UPDATES = ['price', 'quantity'] as const

type PlanChangeTier = Pick<
  BillingTierRecord,
  'ownerType' | 'stripeMonthlyPriceId' | 'stripeYearlyPriceId' | 'stripeProductId'
>

export async function getValidatedStripeTierPrice(
  stripe: Stripe,
  tier: Pick<PlanChangeTier, 'ownerType' | 'stripeProductId'>,
  priceId: string | null
) {
  if (!priceId) throw new Error('Stripe price is required')
  const price = await stripe.prices.retrieve(priceId)
  if (!price.active || !price.recurring) {
    throw new Error(`Stripe price ${price.id} must be an active recurring price`)
  }
  if (tier.ownerType === 'organization' && price.recurring.usage_type !== 'licensed') {
    throw new Error(`Stripe price ${price.id} must be licensed for organization seats`)
  }
  const productId = typeof price.product === 'string' ? price.product : price.product.id
  if (tier.stripeProductId && productId !== tier.stripeProductId) {
    throw new Error(`Stripe price ${price.id} does not belong to ${tier.stripeProductId}`)
  }
  return { id: price.id, productId }
}

async function listPortalConfigurations(stripe: Stripe) {
  const configurations: Stripe.BillingPortal.Configuration[] = []
  for await (const configuration of stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })) {
    configurations.push(configuration)
  }
  const defaultConfiguration = configurations.find((configuration) => configuration.is_default)

  if (!defaultConfiguration) {
    throw new Error('Stripe Billing Portal is not configured')
  }

  return { configurations, defaultConfiguration }
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

export async function buildPlanChangePortalCatalog(stripe: Stripe, tiers: PlanChangeTier[]) {
  const pricesByProduct = new Map<string, string[]>()
  const prices = await Promise.all(
    tiers.flatMap((tier) =>
      [tier.stripeMonthlyPriceId, tier.stripeYearlyPriceId]
        .filter((priceId): priceId is string => Boolean(priceId))
        .map((priceId) => getValidatedStripeTierPrice(stripe, tier, priceId))
    )
  )

  for (const { id, productId } of prices) {
    const productPrices = pricesByProduct.get(productId) ?? []
    productPrices.push(id)
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
  const tiers = await getActiveStripeBillingTiers()
  const [{ defaultConfiguration }, products] = await Promise.all([
    listPortalConfigurations(stripe),
    buildPlanChangePortalCatalog(stripe, tiers),
  ])
  const subscriptionUpdate = defaultConfiguration.features.subscription_update
  const currentProducts = normalizeCatalog(subscriptionUpdate.products)
  const catalogChanged = JSON.stringify(currentProducts) !== JSON.stringify(products)
  const allowedUpdatesChanged =
    subscriptionUpdate.default_allowed_updates.length !== PLAN_CHANGE_ALLOWED_UPDATES.length ||
    PLAN_CHANGE_ALLOWED_UPDATES.some(
      (update) => !subscriptionUpdate.default_allowed_updates.includes(update)
    )

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
          default_allowed_updates: [...PLAN_CHANGE_ALLOWED_UPDATES],
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
    const { features } = defaultConfiguration
    const created = await stripe.billingPortal.configurations.create(
      {
        name: 'TradingGoose billing management',
        business_profile: toBusinessProfile(defaultConfiguration),
        features: {
          ...features,
          payment_method_update: {
            ...features.payment_method_update,
            payment_method_configuration:
              features.payment_method_update.payment_method_configuration ?? undefined,
          },
          subscription_cancel: {
            ...features.subscription_cancel,
            cancellation_reason: {
              ...features.subscription_cancel.cancellation_reason,
              feedback_options:
                features.subscription_cancel.cancellation_reason.feedback_options?.map((option) =>
                  typeof option === 'string' ? option : option.id
                ),
            },
          },
          subscription_update: { enabled: false },
        },
        login_page: { enabled: false },
        metadata: {
          [MANAGEMENT_CONFIGURATION_METADATA_KEY]: MANAGEMENT_CONFIGURATION_METADATA_VALUE,
        },
      },
      { idempotencyKey: MANAGEMENT_CONFIGURATION_IDEMPOTENCY_KEY }
    )
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
