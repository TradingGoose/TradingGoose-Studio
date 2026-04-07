import * as Y from 'yjs'
import { YJS_KEYS } from './workflow-session'

export function rewriteWorkflowContentReferences(
  workflowMap: Y.Map<any>,
  textFields: Y.Map<any>,
  regex: RegExp,
  replacement: string
): void {
  rewriteWorkflowReferencesInBlocks(workflowMap, regex, replacement)
  rewriteWorkflowReferencesInTextFields(textFields, regex, replacement)
}

function rewriteWorkflowReferencesInBlocks(
  workflowMap: Y.Map<any>,
  regex: RegExp,
  replacement: string
): void {
  const blocks: Record<string, any> = workflowMap.get(YJS_KEYS.BLOCKS)
  if (!blocks || typeof blocks !== 'object') return

  let changed = false
  const updatedBlocks: Record<string, any> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    if (!block || !block.subBlocks) {
      updatedBlocks[blockId] = block
      continue
    }

    let blockChanged = false
    const updatedSubBlocks: Record<string, any> = {}

    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks as Record<string, any>)) {
      if (!subBlock || subBlock.value === undefined || subBlock.value === null) {
        updatedSubBlocks[subBlockId] = subBlock
        continue
      }

      const updatedValue = rewriteWorkflowReferenceValue(subBlock.value, regex, replacement)
      if (updatedValue !== subBlock.value) {
        updatedSubBlocks[subBlockId] = { ...subBlock, value: updatedValue }
        blockChanged = true
      } else {
        updatedSubBlocks[subBlockId] = subBlock
      }
    }

    if (blockChanged) {
      updatedBlocks[blockId] = { ...block, subBlocks: updatedSubBlocks }
      changed = true
    } else {
      updatedBlocks[blockId] = block
    }
  }

  if (changed) {
    workflowMap.set(YJS_KEYS.BLOCKS, updatedBlocks)
  }
}

function rewriteWorkflowReferencesInTextFields(
  textFields: Y.Map<any>,
  regex: RegExp,
  replacement: string
): void {
  for (const value of textFields.values()) {
    if (!(value instanceof Y.Text)) {
      continue
    }

    const currentValue = value.toString()
    const updatedValue = rewriteWorkflowReferenceValue(currentValue, regex, replacement)
    if (updatedValue === currentValue) {
      continue
    }

    if (value.length > 0) {
      value.delete(0, value.length)
    }
    if (updatedValue) {
      value.insert(0, updatedValue)
    }
  }
}

function rewriteWorkflowReferenceValue(value: any, regex: RegExp, replacement: string): any {
  if (typeof value === 'string') {
    regex.lastIndex = 0
    if (regex.test(value)) {
      regex.lastIndex = 0
      return value.replace(regex, replacement)
    }
    return value
  }

  if (Array.isArray(value)) {
    let changed = false
    const result = value.map((item) => {
      const updated = rewriteWorkflowReferenceValue(item, regex, replacement)
      if (updated !== item) changed = true
      return updated
    })
    return changed ? result : value
  }

  if (value !== null && typeof value === 'object') {
    let changed = false
    const result: Record<string, any> = {}
    for (const key in value) {
      const updated = rewriteWorkflowReferenceValue(value[key], regex, replacement)
      if (updated !== value[key]) changed = true
      result[key] = updated
    }
    return changed ? result : value
  }

  return value
}
