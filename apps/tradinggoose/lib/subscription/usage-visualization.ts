/**
 * Shared utilities to keep usage visualizations consistent across the app.
 * Mirrors the SIM workspace indicator logic so both surfaces stay aligned.
 */

/**
 * Default number of pills to represent the usage bar.
 * Components can still render fewer pills when space is limited.
 */
export const USAGE_PILL_COUNT = 8

/**
 * Hex colors for different pill states.
 * Using explicit hex values keeps the indicator legible on both light and dark themes.
 */
export const USAGE_PILL_COLORS = {
  UNFILLED: '#414141',
  FILLED: '#ffcc00',
  AT_LIMIT: '#ef4444',
} as const

/**
 * Clamp helper to keep percentages inside the visual range.
 */
const clampPercent = (percentUsed: number) => Math.min(Math.max(percentUsed, 0), 100)

/**
 * Calculate how many pills should be filled for a given usage percentage.
 */
export function calculateFilledPills(percentUsed: number): number {
  const safePercent = clampPercent(percentUsed)
  return Math.ceil((safePercent / 100) * USAGE_PILL_COUNT)
}

/**
 * True when the usage is at (or above) the configured limit.
 */
export function isUsageAtLimit(percentUsed: number): boolean {
  return calculateFilledPills(percentUsed) >= USAGE_PILL_COUNT
}

/**
 * Resolve the correct pill color for a given state.
 */
export function getPillColor(isFilled: boolean, atLimit: boolean): string {
  if (!isFilled) return USAGE_PILL_COLORS.UNFILLED
  if (atLimit) return USAGE_PILL_COLORS.AT_LIMIT
  return USAGE_PILL_COLORS.FILLED
}

/**
 * Generate pill state metadata to simplify rendering.
 */
export function generatePillStates(percentUsed: number) {
  const filled = calculateFilledPills(percentUsed)
  const atLimit = isUsageAtLimit(percentUsed)

  return Array.from({ length: USAGE_PILL_COUNT }, (_, index) => ({
    filled: index < filled,
    color: getPillColor(index < filled, atLimit),
    index,
  }))
}
