'use client'

export async function openBillingPortal(): Promise<void> {
  const response = await fetch('/api/billing/portal', {
    method: 'POST',
  })

  const data = await response.json()

  if (!response.ok || !data?.url) {
    throw new Error(data?.error || 'Failed to start billing portal')
  }

  window.location.href = data.url
}
