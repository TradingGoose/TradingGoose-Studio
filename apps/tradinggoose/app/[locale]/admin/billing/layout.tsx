import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { getBillingGateState } from '@/lib/billing/settings'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { AdminBillingUnavailable } from '@/app/admin/billing/billing-unavailable'

export default async function AdminBillingLayout({ children }: { children: ReactNode }) {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale).admin.billing
  const { stripeConfigured } = await getBillingGateState()

  if (!stripeConfigured) {
    return <AdminBillingUnavailable copy={copy.unavailable} />
  }

  return children
}
