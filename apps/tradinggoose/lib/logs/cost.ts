/** Presentation only. Missing native cost is not a zero-dollar charge. */
export function formatCost(cost?: number | null): string {
  if (cost === undefined || cost === null || !Number.isFinite(cost)) return 'Unavailable'
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  if (cost >= 0.001) return `$${cost.toFixed(4)}`
  if (cost > 0) return `$${cost.toFixed(Math.max(4, Math.abs(Math.floor(Math.log10(cost))) + 3))}`
  return '$0'
}
