import { useCallback, useEffect, useRef } from 'react'
import { isEqual } from 'lodash'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { getProviderFromModel } from '@/providers/ai/utils'
import {
  useBlock,
  useSubBlockValue as useYjsSubBlockValue,
} from '@/lib/yjs/use-workflow-doc'

const logger = createLogger('SubBlockValue')

interface UseSubBlockValueOptions {
  isStreaming?: boolean
  onStreamingEnd?: () => void
}

/**
 * Custom hook to get and set values for a sub-block in a workflow.
 * Handles complex object values properly by using deep equality comparison.
 * Supports explicit streaming mode for AI generation.
 *
 * @param blockId The ID of the block containing the sub-block
 * @param subBlockId The ID of the sub-block
 * @param triggerWorkflowUpdate Whether to trigger a workflow update when the value changes
 * @param options Configuration for debouncing and streaming behavior
 * @returns A tuple containing the current value and setter function
 */
export function useSubBlockValue<T = any>(
  blockId: string,
  subBlockId: string,
  triggerWorkflowUpdate = false,
  options?: UseSubBlockValueOptions
): readonly [T | null, (value: T) => void] {
  const { isStreaming = false, onStreamingEnd } = options || {}

  const { collaborativeSetSubblockValue } = useWorkflowEditorActions()

  const block = useBlock(blockId)
  const blockType = block?.type
  const currentValue = useYjsSubBlockValue(blockId, subBlockId) as T | null

  // Keep a ref to the latest value to prevent unnecessary re-renders
  const valueRef = useRef<T | null>(null)

  // Streaming refs
  const lastEmittedValueRef = useRef<T | null>(null)
  const streamingValueRef = useRef<T | null>(null)
  const wasStreamingRef = useRef<boolean>(false)

  // Check if this is an API key field that could be auto-filled
  const isApiKey =
    subBlockId === 'apiKey' || (subBlockId?.toLowerCase().includes('apikey') ?? false)

  // Get the model subblock value for provider-based blocks
  const modelSubBlockValue = useYjsSubBlockValue(blockId, 'model') as string | null
  const currentApiKeyValue = useYjsSubBlockValue(blockId, 'apiKey') as string | null

  // Determine if this is a provider-based block type
  const isProviderBasedBlock =
    blockType === 'agent' || blockType === 'router' || blockType === 'evaluator'

  // Compute the modelValue based on block type
  const modelValue = isProviderBasedBlock ? (modelSubBlockValue as string) : null

  // Persist the value through the workflow editor action layer.
  const emitValue = useCallback(
    (value: T) => {
      collaborativeSetSubblockValue(blockId, subBlockId, value)
      lastEmittedValueRef.current = value
    },
    [blockId, subBlockId, collaborativeSetSubblockValue]
  )

  // Handle streaming mode changes
  useEffect(() => {
    // If we just exited streaming mode, emit the final value
    if (wasStreamingRef.current && !isStreaming && streamingValueRef.current !== null) {
      logger.debug('Streaming ended, persisting final value', { blockId, subBlockId })
      emitValue(streamingValueRef.current)
      streamingValueRef.current = null
      onStreamingEnd?.()
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, blockId, subBlockId, emitValue, onStreamingEnd])

  // Setter for the live sub-block value.
  const setValue = useCallback(
    (newValue: T) => {
      // Use deep comparison to avoid unnecessary updates for complex objects
      if (!isEqual(valueRef.current, newValue)) {
        valueRef.current = newValue

        // Ensure we're passing the actual value, not a reference that might change
        const valueCopy =
          newValue === null
            ? null
            : typeof newValue === 'object'
              ? JSON.parse(JSON.stringify(newValue))
              : newValue

        // If streaming, hold value locally and do not update global store to avoid render-phase updates
        if (isStreaming) {
          streamingValueRef.current = valueCopy
          return
        }

        // Single Yjs write path: collaborativeSetSubblockValue writes to Yjs
        // and handles declarative cascade clearing for dependent sub-blocks.
        emitValue(valueCopy)

        // Handle model changes for provider-based blocks - clear API key when provider changes.
        // This is a special case not covered by the generic dependsOn cascade.
        if (
          subBlockId === 'model' &&
          isProviderBasedBlock &&
          newValue &&
          typeof newValue === 'string'
        ) {
          if (currentApiKeyValue && currentApiKeyValue !== '') {
            const oldModelValue = currentValue as string
            const oldProvider = oldModelValue ? getProviderFromModel(oldModelValue) : null
            const newProvider = getProviderFromModel(newValue)
            if (oldProvider !== newProvider) {
              collaborativeSetSubblockValue(blockId, 'apiKey', '')
            }
          }
        }
      }
    },
    [
      blockId,
      subBlockId,
      blockType,
      isApiKey,
      currentValue,
      triggerWorkflowUpdate,
      modelValue,
      isStreaming,
      emitValue,
      isProviderBasedBlock,
      collaborativeSetSubblockValue,
      currentApiKeyValue,
    ]
  )

  // Initialize valueRef on first render
  useEffect(() => {
    valueRef.current = currentValue
  }, [])

  // Update the ref if the effective value changes
  // This ensures we're always working with the latest value
  useEffect(() => {
    // Use deep comparison for objects to prevent unnecessary updates
    if (!isEqual(valueRef.current, currentValue)) {
      valueRef.current = currentValue
    }
  }, [currentValue])

  // Return appropriate tuple based on whether options were provided
  return [currentValue, setValue] as const
}
