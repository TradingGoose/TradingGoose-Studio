'use client'

import { useEffect, useMemo, useRef } from 'react'
import { isEqual } from 'lodash'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { SubBlock } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/sub-block'

interface ToolSubBlockRendererProps {
  blockId: string
  subBlockId: string
  toolIndex: number
  subBlock: SubBlockConfig
  effectiveParamId: string
  toolParams: Record<string, any> | undefined
  onParamChange: (toolIndex: number, paramId: string, value: any) => void
  isConnecting: boolean
  disabled: boolean
}

const JSON_VALUE_TYPES = new Set(['checkbox-list', 'grouped-checkbox-list', 'file-upload', 'table'])

const toSignature = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const toParamValue = (type: string, value: unknown): any => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !JSON_VALUE_TYPES.has(type)) return value
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const toStoreValue = (type: string, value: any): any => {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  if (type === 'switch') {
    return value === true || value === 'true' || value === 'True'
  }

  if (type === 'slider') {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? '' : numericValue
  }

  if (JSON_VALUE_TYPES.has(type) && typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  return value
}

export function ToolSubBlockRenderer({
  blockId,
  subBlockId,
  toolIndex,
  subBlock,
  effectiveParamId,
  toolParams,
  onParamChange,
  isConnecting,
  disabled,
}: ToolSubBlockRendererProps) {
  const syntheticId = `${subBlockId}-tool-${toolIndex}-${effectiveParamId}`
  const toolParamValue = toolParams?.[effectiveParamId] ?? ''
  const [storeValue, setStoreValue] = useSubBlockValue<any>(blockId, syntheticId)
  const syncedSignatureRef = useRef<string | null>(null)
  const pendingStoreSignatureRef = useRef<string | null>(null)
  const onParamChangeRef = useRef(onParamChange)
  onParamChangeRef.current = onParamChange

  useEffect(() => {
    const nextStoreValue = toStoreValue(subBlock.type, toolParamValue)
    const nextSignature = toSignature(toParamValue(subBlock.type, nextStoreValue))
    if (nextSignature === syncedSignatureRef.current) return
    syncedSignatureRef.current = nextSignature
    pendingStoreSignatureRef.current = nextSignature
    if (!isEqual(storeValue, nextStoreValue)) {
      setStoreValue(nextStoreValue)
    }
  }, [setStoreValue, storeValue, subBlock.type, toolParamValue])

  useEffect(() => {
    const nextParamValue = toParamValue(subBlock.type, storeValue)
    const nextSignature = toSignature(nextParamValue)
    if (pendingStoreSignatureRef.current !== null) {
      if (nextSignature === pendingStoreSignatureRef.current) {
        pendingStoreSignatureRef.current = null
      }
      return
    }
    if (nextSignature === syncedSignatureRef.current) return
    syncedSignatureRef.current = nextSignature
    onParamChangeRef.current(toolIndex, effectiveParamId, nextParamValue)
  }, [effectiveParamId, storeValue, subBlock.type, toolIndex])

  const config = useMemo(
    () => ({
      ...subBlock,
      id: syntheticId,
    }),
    [subBlock, syntheticId]
  )

  return (
    <SubBlock
      blockId={blockId}
      config={config}
      isConnecting={isConnecting}
      disabled={disabled}
      contextValues={toolParams}
    />
  )
}
