export const MAX_COPILOT_CONTEXTS_PER_TURN = 16
export const MAX_COPILOT_CONTEXT_BYTES_PER_ITEM = 16 * 1_024
export const MAX_COPILOT_CONTEXT_BYTES_PER_TURN = 64 * 1_024
export const MAX_WORKFLOW_LOGS_PER_READ = 10

export const COPILOT_CONTEXT_PROJECTION_LIMITS = {
  maxArrayItems: 24,
  maxDepth: 6,
  maxNodes: 384,
  maxObjectEntries: 32,
  maxStringBytes: 2_048,
}
