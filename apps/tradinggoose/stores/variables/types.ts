export type VariableType = 'plain' | 'number' | 'boolean' | 'object' | 'array'

/**
 * Represents a workflow variable with workflow-specific naming
 * Variable names must be unique within each workflow
 */
export interface Variable {
  id: string
  workflowId: string
  name: string // Must be unique per workflow
  type: VariableType
  value: any
  validationError?: string // Tracks format validation errors
}
