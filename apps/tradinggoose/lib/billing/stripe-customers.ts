import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'

type StripeCustomerCreateClient = {
  customers: Pick<Stripe.CustomersResource, 'create'>
}
type StripeCustomerClient = {
  customers: Pick<Stripe.CustomersResource, 'create' | 'retrieve'>
}
type StripeUserCustomerRecord = {
  stripeCustomerId: string | null
  email: string
  name: string
}
type StripeUserCustomerDbClient = {
  select: any
  update: any
}
type StripeUserCustomerLogger = {
  info?: (message: string, payload?: Record<string, unknown>) => void
  warn?: (message: string, payload?: Record<string, unknown>) => void
}

export function getStripeUserCustomerCreateIdempotencyKey(userId: string) {
  const hashedUserId = createHash('sha256').update(userId).digest('hex')
  return `auth-signup:user-customer:${hashedUserId}`
}

export function getStripeUserCustomerReplacementIdempotencyKey(
  userId: string,
  staleCustomerId: string
) {
  const hashedReplacementTarget = createHash('sha256')
    .update(`${userId}:${staleCustomerId}`)
    .digest('hex')
  // Preserve the historical namespace so retries reuse the same Stripe idempotency key
  // across portal-initiated and shared-helper replacement flows.
  return `billing-portal:user-customer-replacement:${hashedReplacementTarget}`
}

export async function createStripeUserCustomer(
  stripe: StripeCustomerCreateClient,
  params: {
    email: string
    name: string
    userId: string
  },
  idempotencyKey: string = getStripeUserCustomerCreateIdempotencyKey(params.userId)
) {
  return stripe.customers.create(
    {
      email: params.email,
      name: params.name,
      metadata: {
        userId: params.userId,
        customerType: 'user',
      },
    },
    {
      idempotencyKey,
    }
  )
}

export async function ensureStripeUserCustomer(
  stripe: StripeCustomerClient,
  params: {
    userId: string
    dbClient?: StripeUserCustomerDbClient
    logger?: StripeUserCustomerLogger
  }
): Promise<Stripe.Customer | null> {
  const dbClient = params.dbClient ?? db
  const rows = (await dbClient
    .select({
      stripeCustomerId: user.stripeCustomerId,
      email: user.email,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, params.userId))
    .limit(1)) as StripeUserCustomerRecord[]

  const userRecord = rows[0]
  if (!userRecord) {
    return null
  }

  let replacementCustomerId: string | null = null

  if (userRecord.stripeCustomerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(userRecord.stripeCustomerId)

      if (!isDeletedStripeCustomer(existingCustomer)) {
        return existingCustomer
      }

      params.logger?.warn?.('Stored personal Stripe customer is deleted; recreating', {
        userId: params.userId,
        stripeCustomerId: userRecord.stripeCustomerId,
      })
      replacementCustomerId = userRecord.stripeCustomerId
    } catch (error) {
      if (!isMissingStripeCustomerError(error)) {
        params.logger?.warn?.('Stored personal Stripe customer lookup failed; keeping mapping', {
          userId: params.userId,
          stripeCustomerId: userRecord.stripeCustomerId,
          error,
        })
        throw error
      }

      params.logger?.warn?.('Stored personal Stripe customer is missing; recreating', {
        userId: params.userId,
        stripeCustomerId: userRecord.stripeCustomerId,
        error,
      })
      replacementCustomerId = userRecord.stripeCustomerId
    }
  }

  const stripeCustomer = await createStripeUserCustomer(
    stripe,
    {
      email: userRecord.email,
      name: userRecord.name,
      userId: params.userId,
    },
    replacementCustomerId
      ? getStripeUserCustomerReplacementIdempotencyKey(params.userId, replacementCustomerId)
      : undefined
  )

  await dbClient
    .update(user)
    .set({
      stripeCustomerId: stripeCustomer.id,
      updatedAt: new Date(),
    })
    .where(eq(user.id, params.userId))

  params.logger?.info?.('Ensured personal Stripe customer', {
    userId: params.userId,
    stripeCustomerId: stripeCustomer.id,
  })

  return stripeCustomer
}

export function getStripeCustomerDefaultPaymentMethodId(
  customer:
    | {
        invoice_settings?: {
          default_payment_method?:
            | string
            | {
                id?: string | null
              }
            | null
        } | null
      }
    | null
    | undefined
): string | null {
  const defaultPaymentMethod = customer?.invoice_settings?.default_payment_method

  if (typeof defaultPaymentMethod === 'string') {
    return defaultPaymentMethod
  }

  return defaultPaymentMethod?.id ?? null
}

export function isDeletedStripeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): customer is Stripe.DeletedCustomer {
  return Boolean(customer && 'deleted' in customer && customer.deleted)
}

export function isMissingStripeCustomerError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const stripeError = error as Error & {
    code?: string
    message?: string
    param?: string
    statusCode?: number
    type?: string
  }

  if (stripeError.code === 'resource_missing') {
    return true
  }

  if (
    stripeError.type !== 'StripeInvalidRequestError' &&
    stripeError.statusCode !== 404 &&
    stripeError.param !== 'customer'
  ) {
    return false
  }

  return /no such customer/i.test(stripeError.message ?? '')
}
