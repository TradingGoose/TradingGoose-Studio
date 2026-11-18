import type Stripe from 'stripe'
import { getCurrentStripeClient } from '@/lib/system-services/stripe-runtime'

/**
 * Get the Stripe client instance, throwing an error if not available
 * Use this when Stripe operations are required
 */
export function requireStripeClient(): Stripe {
  const client = getCurrentStripeClient()

  if (!client) {
    throw new Error(
      'Stripe client is not available. Configure STRIPE_SECRET_KEY in apps/tradinggoose/.env.'
    )
  }

  return client
}
