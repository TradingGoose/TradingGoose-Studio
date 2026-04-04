import { useCallback } from 'react'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'

/**
 * Hook for handling immediate tag dropdown selections
 * Uses the collaborative workflow system but with immediate processing
 */
export function useTagSelection(blockId: string, subblockId: string) {
  const { collaborativeSetTagSelection } = useWorkflowEditorActions()

  const emitTagSelectionValue = useCallback(
    (value: any) => {
      // Use the collaborative system with immediate processing (no debouncing)
      collaborativeSetTagSelection(blockId, subblockId, value)
    },
    [blockId, subblockId, collaborativeSetTagSelection]
  )

  return emitTagSelectionValue
}
