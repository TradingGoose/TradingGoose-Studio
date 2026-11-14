export function isCopilotServerToolReviewResult(result: unknown): result is {
  requiresReview: true
} {
  return (
    !!result &&
    typeof result === 'object' &&
    (result as { requiresReview?: unknown }).requiresReview === true
  )
}
