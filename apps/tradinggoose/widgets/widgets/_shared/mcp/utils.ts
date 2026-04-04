// Barrel re-exports so widget-local imports resolve without reaching into entity_review/.
export * from '@/widgets/widgets/entity_review/mcp-utils'
export {
  buildPersistedPairContext,
  buildPersistedReviewParams,
  readEntitySelectionState,
} from '@/widgets/widgets/entity_review/review-target-utils'
