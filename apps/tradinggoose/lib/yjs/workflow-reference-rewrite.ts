import type * as Y from 'yjs'
import {
  parseWorkflowSubBlockFieldKey,
  readWorkflowSubBlockFieldsMap,
  readWorkflowSubBlockFieldValueFromMap,
  setWorkflowSubBlockValues,
} from './workflow-session'

export function rewriteWorkflowContentReferences(
  doc: Y.Doc,
  regex: RegExp,
  replacement: string
): void {
  const fields = readWorkflowSubBlockFieldsMap(doc)
  const updates: Array<{ blockId: string; subBlockId: string; value: any }> = []
  for (const key of fields.keys()) {
    const parsed = parseWorkflowSubBlockFieldKey(key)
    if (!parsed) continue
    const currentValue = readWorkflowSubBlockFieldValueFromMap(
      fields,
      parsed.blockId,
      parsed.subBlockId
    )
    const updatedValue = rewriteWorkflowReferenceValue(currentValue, regex, replacement)
    if (updatedValue !== currentValue) updates.push({ ...parsed, value: updatedValue })
  }
  setWorkflowSubBlockValues(doc, updates)
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
