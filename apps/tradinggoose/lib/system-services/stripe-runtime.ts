import Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveStripeServiceConfig } from './runtime'

const STRIPE_API_VERSION = '2025-08-27.basil'
const MISSING_STRIPE_CLIENT_ERROR =
  'Stripe client is not available. Configure Stripe in admin services.'

const logger = createLogger('SystemStripeRuntime')

type CachedStripeServiceConfig = {
  secretKey: string | null
  webhookSecret: string | null
}

const stripeClientsBySecret = new Map<string, Stripe>()

let cachedStripeServiceConfig: CachedStripeServiceConfig = {
  secretKey: null,
  webhookSecret: null,
}

export function getCachedStripeServiceConfig(): CachedStripeServiceConfig {
  return cachedStripeServiceConfig
}

export function hasCachedStripeServiceSecretKey() {
  return Boolean(cachedStripeServiceConfig.secretKey)
}

function setCachedStripeServiceConfig(settings: CachedStripeServiceConfig) {
  cachedStripeServiceConfig = {
    secretKey: normalizeSecret(settings.secretKey),
    webhookSecret: normalizeSecret(settings.webhookSecret),
  }
}

async function refreshCachedStripeServiceConfig() {
  try {
    const settings = await resolveStripeServiceConfig()
    setCachedStripeServiceConfig({
      secretKey: settings.secretKey,
      webhookSecret: settings.webhookSecret,
    })
  } catch (error) {
    logger.error('Failed to refresh cached Stripe settings', { error })
  }

  return getCachedStripeServiceConfig()
}

export function getCurrentStripeClient(): Stripe | null {
  const secretKey = cachedStripeServiceConfig.secretKey
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

await refreshCachedStripeServiceConfig()

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
