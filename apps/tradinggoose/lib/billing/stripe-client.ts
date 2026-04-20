import type Stripe from 'stripe'
import {
  getCurrentStripeClient,
  hasStripeSecretKey,
} from '@/lib/system-services/stripe-runtime'

/**
 * Check if deployment-owned Stripe credentials are configured.
 */
export function hasValidStripeCredentials(): boolean {
  return hasStripeSecretKey()
}

/**
 * Get the Stripe client instance
 * @returns Stripe client or null if credentials are not available
 */
export function getStripeClient(): Stripe | null {
  return getCurrentStripeClient()
}

/**
 * Get the Stripe client instance, throwing an error if not available
 * Use this when Stripe operations are required
 */
export function requireStripeClient(): Stripe {
  const client = getStripeClient()

  if (!client) {
    throw new Error(
      'Stripe client is not available. Configure STRIPE_SECRET_KEY in apps/tradinggoose/.env.'
    )
  }

  return client
}
