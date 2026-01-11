export function triggerListingRankUpdate(listingId: string) {
  if (!listingId) return
  const query = new URLSearchParams({ listing_id: listingId })
  void fetch(`/api/market/update/listing-rank?${query.toString()}`, {
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
