'use client'

import { useMemo } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { useBlock } from '@/lib/yjs/use-workflow-doc'

/**
 * Centralized dependsOn gating for sub-block components.
 * - Computes dependency values from the active workflow/block
 * - Returns a stable disabled flag to pass to inputs and to guard effects
 */
export function useDependsOnGate(
  blockId: string,
  subBlock: SubBlockConfig,
  opts?: { disabled?: boolean; contextValues?: Record<string, any> }
) {
  const disabledProp = opts?.disabled ?? false
  const contextValues = opts?.contextValues

  const block = useBlock(blockId)

  // Use only explicit dependsOn from block config. No inference.
  const dependsOn: string[] = (subBlock.dependsOn as string[] | undefined) || []

  const normalizeDependencyValue = (rawValue: unknown): unknown => {
    if (rawValue === null || rawValue === undefined) return null

    if (typeof rawValue === 'object') {
      if (Array.isArray(rawValue)) {
        return rawValue.length === 0 ? null : rawValue.map((item) => normalizeDependencyValue(item))
      }

      const record = rawValue as Record<string, any>
      if ('value' in record) return normalizeDependencyValue(record.value)
      if ('id' in record) return record.id
      return record
    }

    return rawValue
  }

  const dependencyValues = useMemo(() => {
    if (dependsOn.length === 0) return [] as any[]

    if (contextValues) {
      return dependsOn.map((depKey) => normalizeDependencyValue(contextValues[depKey]) ?? null)
    }

    if (!block?.subBlocks) return dependsOn.map(() => null)
    return dependsOn.map((depKey) => normalizeDependencyValue(block.subBlocks[depKey]?.value) ?? null)
  }, [dependsOn, contextValues, block]) as any[]

  const depsSatisfied = useMemo(() => {
    if (dependsOn.length === 0) return true
    return dependencyValues.every((v) =>
      typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined && v !== ''
    )
  }, [dependencyValues, dependsOn])

  // Block everything except the credential field itself until dependencies are set
  const blocked = dependsOn.length > 0 && !depsSatisfied && subBlock.type !== 'oauth-input'

  const finalDisabled = disabledProp || blocked

  return {
    dependsOn,
    dependencyValues,
    depsSatisfied,
    blocked,
    finalDisabled,
  }
}
