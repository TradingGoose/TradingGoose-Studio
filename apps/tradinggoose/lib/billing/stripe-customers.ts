import { createHash } from 'node:crypto'
import type Stripe from 'stripe'

type StripeCustomerCreateClient = Pick<Stripe, 'customers'>

export function getStripeUserCustomerCreateIdempotencyKey(userId: string) {
  const hashedUserId = createHash('sha256').update(userId).digest('hex')
  return `auth-signup:user-customer:${hashedUserId}`
}

export async function createStripeUserCustomer(
  stripe: StripeCustomerCreateClient,
  params: {
    email: string
    name: string
    userId: string
  }
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
      idempotencyKey: getStripeUserCustomerCreateIdempotencyKey(params.userId),
    }
  )
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
