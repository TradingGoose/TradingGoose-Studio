import type { ListingInputValue } from '@/lib/listing/identity'

export function triggerEquityRankUpdate(listing: ListingInputValue) {
  const equityId =
    listing && typeof listing === 'object' && 'equity_id' in listing
      ? (listing as { equity_id?: string | null }).equity_id ?? null
      : null
  if (!equityId) return
  const query = new URLSearchParams({ equity_id: equityId })
  void fetch(`/api/market/update/equity-rank?${query.toString()}`, {
    method: 'POST',
  }).catch(() => {
    // Best-effort update; ignore failures to avoid blocking selection.
  })
}

export function triggerCryptoRankUpdate(cryptoId: string) {
  if (!cryptoId) return
  const query = new URLSearchParams({ crypto_id: cryptoId })
  void fetch(`/api/market/update/crypto-rank?${query.toString()}`, {
    method: 'POST',
  }).catch(() => {
    // Best-effort update; ignore failures to avoid blocking selection.
  })
}

export function triggerCurrencyRankUpdate(currencyId: string) {
  if (!currencyId) return
  const query = new URLSearchParams({ currency_id: currencyId })
  void fetch(`/api/market/update/currency-rank?${query.toString()}`, {
    method: 'POST',
  }).catch(() => {
    // Best-effort update; ignore failures to avoid blocking selection.
  })
}
