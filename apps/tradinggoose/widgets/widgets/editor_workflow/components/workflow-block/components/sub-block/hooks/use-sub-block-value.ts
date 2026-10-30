import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { useBlock, useSubBlockValue as useYjsSubBlockValue } from '@/lib/yjs/use-workflow-doc'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { getProviderFromModel } from '@/providers/ai/models'
import type { ProviderId } from '@/providers/ai/types'

export function useSubBlockValue<T = any>(
  blockId: string,
  subBlockId: string
): readonly [T | null, (value: T) => void] {
  const { collaborativeSetSubblockValue } = useWorkflowEditorActions()
  const blockType = useBlock(blockId)?.type
  const currentValue = useYjsSubBlockValue(blockId, subBlockId) as T | null
  const currentApiKeyValue = useYjsSubBlockValue(blockId, 'apiKey') as string | null
  const valueRef = useRef(currentValue)
  const lastProviderRef = useRef<ProviderId | null>(null)
  const isProviderModel =
    subBlockId === 'model' &&
    (blockType === 'agent' || blockType === 'router' || blockType === 'evaluator')

  const setValue = useCallback(
    (newValue: T) => {
      if (isEqual(valueRef.current, newValue)) return
      valueRef.current = newValue
      const valueCopy =
        newValue !== null && typeof newValue === 'object'
          ? JSON.parse(JSON.stringify(newValue))
          : newValue
      collaborativeSetSubblockValue(blockId, subBlockId, valueCopy)

      if (!isProviderModel || typeof newValue !== 'string') return
      let newProvider: ProviderId
      try {
        newProvider = getProviderFromModel(newValue)
      } catch {
        // Partial model names are valid editor drafts, not provider changes.
        return
      }
      if (currentApiKeyValue && lastProviderRef.current !== newProvider) {
        collaborativeSetSubblockValue(blockId, 'apiKey', '')
      }
      lastProviderRef.current = newProvider
    },
    [blockId, subBlockId, isProviderModel, collaborativeSetSubblockValue, currentApiKeyValue]
  )

  useEffect(() => {
    lastProviderRef.current = null
  }, [blockId, subBlockId])

  useEffect(() => {
    valueRef.current = currentValue
    if (isProviderModel && typeof currentValue === 'string') {
      try {
        lastProviderRef.current = getProviderFromModel(currentValue)
      } catch {
        // Retain the last resolved provider while a draft is incomplete.
      }
    }
  }, [blockId, subBlockId, currentValue, isProviderModel])

  return [currentValue, setValue] as const
}
