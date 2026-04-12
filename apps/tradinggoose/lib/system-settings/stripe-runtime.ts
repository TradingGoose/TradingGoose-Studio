import Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'
import { getResolvedSystemSettings } from './service'

const STRIPE_API_VERSION = '2025-08-27.basil'
const MISSING_STRIPE_CLIENT_ERROR =
  'Stripe client is not available. Configure STRIPE_SECRET_KEY in system settings.'

const logger = createLogger('SystemStripeRuntime')

type CachedStripeSettings = {
  stripeSecretKey: string | null
  stripeWebhookSecret: string | null
}

const stripeClientsBySecret = new Map<string, Stripe>()

let cachedStripeSettings: CachedStripeSettings = {
  stripeSecretKey: null,
  stripeWebhookSecret: null,
}

export function getCachedStripeSettings(): CachedStripeSettings {
  return cachedStripeSettings
}

export function hasCachedStripeSecretKey() {
  return Boolean(cachedStripeSettings.stripeSecretKey)
}

export function setCachedStripeSettings(settings: CachedStripeSettings) {
  cachedStripeSettings = {
    stripeSecretKey: normalizeSecret(settings.stripeSecretKey),
    stripeWebhookSecret: normalizeSecret(settings.stripeWebhookSecret),
  }
}

export async function refreshCachedStripeSettings() {
  try {
    const settings = await getResolvedSystemSettings()
    setCachedStripeSettings({
      stripeSecretKey: settings.stripeSecretKey,
      stripeWebhookSecret: settings.stripeWebhookSecret,
    })
  } catch (error) {
    logger.error('Failed to refresh cached Stripe settings', { error })
  }

  return getCachedStripeSettings()
}

export function getCurrentStripeClient(): Stripe | null {
  const secretKey = cachedStripeSettings.stripeSecretKey
  if (!secretKey) {
    return null
  }

  const existingClient = stripeClientsBySecret.get(secretKey)
  if (existingClient) {
    return existingClient
  }

  const client = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  })

  stripeClientsBySecret.set(secretKey, client)
  return client
}

export function createStripeClientProxy(): Stripe {
  return new Proxy({} as Stripe, {
    get(_target, prop) {
      if (prop === Symbol.toStringTag) {
        return 'Stripe'
      }

      const client = getCurrentStripeClient()
      if (!client) {
        return createUnavailableStripeValue()
      }

      const value = Reflect.get(client as object, prop, client)
      return typeof value === 'function' ? value.bind(client) : value
    },
  }) as Stripe
}

await refreshCachedStripeSettings()

function normalizeSecret(value: string | null) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function createUnavailableStripeValue(): unknown {
  return new Proxy(function unavailableStripeCall() {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return undefined
      }

      if (prop === Symbol.toStringTag) {
        return 'Stripe'
      }

      return createUnavailableStripeValue()
    },
    apply() {
      throw new Error(MISSING_STRIPE_CLIENT_ERROR)
    },
    construct() {
      throw new Error(MISSING_STRIPE_CLIENT_ERROR)
    },
  })
}
