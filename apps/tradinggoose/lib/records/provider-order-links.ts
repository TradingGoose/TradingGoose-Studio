export type ProviderOrderLinkInput = Pick<
  {
    provider: string
    environment: string | null
    providerOrderId: string | null
    accountId: string | null
  },
  'provider' | 'environment' | 'providerOrderId' | 'accountId'
>

export function getProviderOrderExternalUrl(_order: ProviderOrderLinkInput) {
  return null
}
