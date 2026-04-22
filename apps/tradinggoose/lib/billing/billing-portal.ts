'use client'

import { getBaseUrl } from '@/lib/urls/utils'

export type BillingPortalContext = 'user' | 'organization'

export interface OpenBillingPortalOptions {
  context: BillingPortalContext
  organizationId?: string
  returnUrl?: string
}

function getDefaultBillingPortalReturnUrl() {
  return `${getBaseUrl()}/workspace?billing=updated`
}

export async function openBillingPortal({
  context,
  organizationId,
  returnUrl = getDefaultBillingPortalReturnUrl(),
}: OpenBillingPortalOptions): Promise<void> {
  const response = await fetch('/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context,
      organizationId,
      returnUrl,
    }),
  })

  const data = await response.json()

  if (!response.ok || !data?.url) {
    throw new Error(data?.error || 'Failed to start billing portal')
  }

  window.location.href = data.url
}
