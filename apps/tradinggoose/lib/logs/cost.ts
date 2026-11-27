/** Presentation only. Missing native cost is not a zero-dollar charge. */
export function formatCost(
  cost?: number | null,
  currencyDisplay: 'symbol' | 'code' = 'symbol'
): string {
  if (cost === undefined || cost === null || !Number.isFinite(cost)) return 'Unavailable'
  let amount = '0'
  if (cost >= 1) amount = cost.toFixed(2)
  else if (cost >= 0.01) amount = cost.toFixed(3)
  else if (cost >= 0.001) amount = cost.toFixed(4)
  else if (cost > 0) amount = cost.toFixed(Math.max(4, Math.abs(Math.floor(Math.log10(cost))) + 3))
  return currencyDisplay === 'code' ? `${amount} USD` : `$${amount}`
}
