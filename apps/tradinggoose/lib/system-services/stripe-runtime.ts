import Stripe from 'stripe'
import { env } from '@/lib/env'

const STRIPE_API_VERSION = '2025-08-27.basil'
const MISSING_STRIPE_CLIENT_ERROR =
  'Stripe client is not available. Configure STRIPE_SECRET_KEY in apps/tradinggoose/.env.'

type StripeServiceConfig = {
  secretKey: string | null
  webhookSecret: string | null
}

// Stripe is deployment-owned; secrets come from env-backed config, not DB-backed services.
const stripeClientsBySecret = new Map<string, Stripe>()

export function hasStripeSecretKey() {
  return Boolean(getStripeServiceConfig().secretKey)
}

export function getStripeServiceConfig(): StripeServiceConfig {
  return {
    secretKey: normalizeSecret(env.STRIPE_SECRET_KEY),
    webhookSecret: normalizeSecret(env.STRIPE_WEBHOOK_SECRET),
  }
}

export function getCurrentStripeClient(): Stripe | null {
  const secretKey = getStripeServiceConfig().secretKey
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

function normalizeSecret(value: string | null | undefined) {
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
