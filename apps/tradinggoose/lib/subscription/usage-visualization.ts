/**
 * Shared utilities for consistent usage visualization across the application.
 *
 * This module provides a single source of truth for how usage metrics are
 * displayed visually through "pills" or progress indicators.
 */

/**
 * Number of pills to display in usage indicators.
 *
 * Using 8 pills provides:
 * - 12.5% granularity per pill
 * - Good balance between precision and visual clarity
 * - Consistent representation across panel and settings
 */
export const USAGE_PILL_COUNT = 8

/**
 * Calculate the number of filled pills based on usage percentage.
 *
 * Uses Math.ceil() to ensure even minimal usage (0.01%) shows visual feedback.
 * This provides better UX by making it clear that there is some usage, even if small.
 *
 * @param percentUsed - The usage percentage (0-100). Can be a decimal (e.g., 0.315 for 0.315%)
 * @returns Number of pills that should be filled (0 to USAGE_PILL_COUNT)
 *
 * @example
 * calculateFilledPills(0.315)  // Returns 1 (shows feedback for 0.315% usage)
 * calculateFilledPills(50)     // Returns 4 (50% of 8 pills)
 * calculateFilledPills(100)    // Returns 8 (completely filled)
 * calculateFilledPills(150)    // Returns 8 (clamped to maximum)
 */
export function calculateFilledPills(percentUsed: number): number {
  // Clamp percentage to valid range [0, 100]
  const safePercent = Math.min(Math.max(percentUsed, 0), 100)

  // Calculate filled pills using ceil to show feedback for any usage
  return Math.ceil((safePercent / 100) * USAGE_PILL_COUNT)
}
