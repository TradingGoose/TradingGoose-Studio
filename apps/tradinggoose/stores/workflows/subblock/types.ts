export interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, any>>> // Store values per workflow ID
  loadingWebhooks: Set<string>
  checkedWebhooks: Set<string>
}

export interface SubBlockStore extends SubBlockState {
  setValue: (blockId: string, subBlockId: string, value: any, workflowId?: string) => void
  getValue: (blockId: string, subBlockId: string, workflowId?: string) => any
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => void
  setWorkflowValues: (workflowId: string, values: Record<string, Record<string, any>>) => void
  // Add debounced sync function
  syncWithDB: () => void
}
