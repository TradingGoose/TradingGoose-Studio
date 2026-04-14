import type { ReactNode } from 'react'
import { getBillingGateState } from '@/lib/billing/settings'
import { AdminBillingUnavailable } from './billing-unavailable'

export default async function AdminBillingLayout({ children }: { children: ReactNode }) {
  const { stripeConfigured } = await getBillingGateState()

  if (!stripeConfigured) {
    return (
      <AdminBillingUnavailable
        title='Billing UI unavailable'
        description='The admin billing section stays hidden until Stripe is configured in deployment env.'
      />
    )
  }

  return children
}
