import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { isEqual } from 'lodash'
import { reasoningSelectionError } from '@/lib/mastra/reasoning'
import type { RegistryModel } from '@/lib/mastra/registry'
import { containsWorkflowReference } from '@/lib/workflows/references'
import { useBlock, useSubBlockValue as useYjsSubBlockValue } from '@/lib/yjs/use-workflow-doc'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { getModelProvider, getRegistryModel, useModelRegistry } from '@/stores/model-registry'

export function useSubBlockValue<T = any>(
  blockId: string,
  subBlockId: string,
  disabled = false
): readonly [T | null, (value: T) => void] {
  const { collaborativeSetSubblockValue } = useWorkflowEditorActions()
  const block = useBlock(blockId)
  const blockType = block?.type
  const currentValue = useYjsSubBlockValue(blockId, subBlockId) as T | null
  const currentApiKeyValue = useYjsSubBlockValue(blockId, 'apiKey') as string | null
  const valueRef = useRef(currentValue)
  const lastProviderRef = useRef<string | null>(null)
  const providers = useModelRegistry((state) => state.providers)
  const isProviderModel =
    subBlockId === 'model' &&
    ['agent', 'router', 'evaluator', 'translate', 'vision', 'guardrails'].includes(blockType ?? '')

  const modelId = block?.subBlocks?.model?.value
  const effortModel = useModelRegistry(
    () =>
      !disabled &&
      blockType === 'agent' &&
      (subBlockId === 'model' || subBlockId === 'reasoningEffort') &&
      typeof modelId === 'string'
        ? getRegistryModel(modelId)
        : undefined,
    isEqual
  )

  const effort = block?.subBlocks?.reasoningEffort?.value
  const reconcileEffort = useCallback(
    (id: string, model: RegistryModel | undefined) => {
      if (
        model &&
        !containsWorkflowReference(effort) &&
        reasoningSelectionError(model.id, model.reasoningOptions, effort)
      ) {
        collaborativeSetSubblockValue(
          id,
          'reasoningEffort',
          model.reasoningOptions?.[0]?.defaultValue ?? ''
        )
      }
    },
    [effort, collaborativeSetSubblockValue]
  )
  const restoreEffort = useEffectEvent(reconcileEffort)

  // The visible effort field restores its own value after its Yjs subscription is active.
  useEffect(() => {
    if (
      effortModel &&
      (subBlockId === 'reasoningEffort' || !effortModel.reasoningOptions?.length)
    ) {
      restoreEffort(blockId, effortModel)
    }
  }, [blockId, subBlockId, effortModel])

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
      if (providers.length === 0) {
        if (currentApiKeyValue) collaborativeSetSubblockValue(blockId, 'apiKey', '')
        return
      }
      if (blockType === 'agent') reconcileEffort(blockId, getRegistryModel(newValue))
      const newProvider = getModelProvider(newValue)
      if (!newProvider) return
      if (currentApiKeyValue && lastProviderRef.current !== newProvider) {
        collaborativeSetSubblockValue(blockId, 'apiKey', '')
      }
      lastProviderRef.current = newProvider
    },
    [
      blockId,
      subBlockId,
      isProviderModel,
      blockType,
      reconcileEffort,
      collaborativeSetSubblockValue,
      currentApiKeyValue,
      providers,
    ]
  )

  useEffect(() => {
    lastProviderRef.current = null
  }, [blockId, subBlockId])

  useEffect(() => {
    valueRef.current = currentValue
    if (isProviderModel && typeof currentValue === 'string') {
      lastProviderRef.current = getModelProvider(currentValue) ?? lastProviderRef.current
    }
  }, [blockId, subBlockId, currentValue, isProviderModel, providers])

  return [currentValue, setValue] as const
}
