/**
 * Pure workflow-variable mutation helpers that operate on a Yjs document.
 *
 * These preserve the retired variables-store mutation semantics so that
 * collaborative edits via Yjs produce identical results:
 *
 *  - autoGenerateVariableName: `variable1`, `variable2`, ...
 *  - ensureUniqueVariableName: appends ` (N)` suffixes on collision
 *  - coerceVariableType: maps deprecated `'string'` -> `'plain'`
 *  - validateVariableValue: format validation without value mutation
 *  - rewriteVariableReferences: `<variable.foo>` reference rewriting in blocks
 */

import * as Y from 'yjs'
import type { Variable } from '@/stores/variables/types'
import { escapeRegExp } from '@/lib/utils'
import { getVariablesMap, getWorkflowMap, getWorkflowTextFieldsMap } from './workflow-session'
import { rewriteWorkflowContentReferences } from './workflow-reference-rewrite'

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

/**
 * Auto-generates the next `variableN` name based on existing names.
 *
 * Mirrors the logic in `addVariable`: finds the highest existing N among names
 * matching `/^variable\d+$/` and returns `variable(N+1)`.  Returns `variable1`
 * when no matching names exist.
 */
export function autoGenerateVariableName(existingNames: string[]): string {
  const existingNumbers = existingNames
    .map((name) => {
      const match = name.match(/^variable(\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => !Number.isNaN(n))

  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1
  return `variable${nextNumber}`
}

/**
 * Ensures `name` is unique among `existingNames`.
 *
 * If a collision is found the name is suffixed with ` (1)`, ` (2)`, etc.
 * until a unique variant is produced.  Empty/whitespace-only names are
 * returned as-is (they represent transient editing states).
 */
export function ensureUniqueVariableName(name: string, existingNames: string[]): string {
  if (name.trim() === '') return name

  let uniqueName = name
  let index = 1

  while (existingNames.includes(uniqueName)) {
    uniqueName = `${name} (${index})`
    index++
  }

  return uniqueName
}

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

/**
 * Coerces the deprecated `'string'` variable type to `'plain'`.
 * All other types pass through unchanged.
 */
export function coerceVariableType(type: string): string {
  return type === 'string' ? 'plain' : type
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a variable value against its declared type.
 *
 * Returns `null` when valid, or a human-readable error string when invalid.
 * This mirrors the `validateVariable` helper in the Zustand store -- it never
 * mutates the value, only inspects it.
 */
export function validateVariableValue(type: string, value: any): string | null {
  const effectiveType = coerceVariableType(type)

  try {
    switch (effectiveType) {
      case 'number': {
        if (Number.isNaN(Number(value))) {
          return 'Not a valid number'
        }
        break
      }

      case 'boolean': {
        if (!/^(true|false)$/i.test(String(value).trim())) {
          return 'Expected "true" or "false"'
        }
        break
      }

      case 'object': {
        try {
          const trimmed = String(value).trim()

          if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            return 'Not a valid object format'
          }

          // Use Function constructor to support both JSON and JS object-literal
          // syntax, matching the existing store implementation.
          const parsed = new Function(`return ${trimmed}`)()

          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }
        } catch {
          return 'Invalid object syntax'
        }
        break
      }

      case 'array': {
        try {
          const parsed = JSON.parse(String(value))
          if (!Array.isArray(parsed)) {
            return 'Not a valid JSON array'
          }
        } catch {
          return 'Invalid JSON array syntax'
        }
        break
      }

      // 'plain' and any unknown types have no validation constraints
      default:
        break
    }

    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid format'
  }
}

// ---------------------------------------------------------------------------
// Reference rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrites `<variable.oldName>` references to `<variable.newName>` inside
 * every block's subBlock values and any text-backed workflow subblocks stored
 * in the Yjs document.
 *
 * Name comparison is case-insensitive and ignores internal whitespace,
 * matching the existing Zustand store behaviour.
 *
 * The update is performed inside a single Yjs transaction so remote peers
 * receive it atomically.
 */
export function rewriteVariableReferences(
  doc: Y.Doc,
  oldName: string,
  newName: string,
  origin?: string
): void {
  if (oldName === newName || oldName.trim() === '' || newName.trim() === '') return

  doc.transact(() => {
    rewriteVariableReferencesInWorkflowContent(
      getWorkflowMap(doc),
      getWorkflowTextFieldsMap(doc),
      oldName,
      newName
    )
  }, origin ?? 'variable-rename')
}

// ---------------------------------------------------------------------------
// Yjs-backed variable mutations
// ---------------------------------------------------------------------------

export function addWorkflowVariable(
  doc: Y.Doc,
  variable: Omit<Variable, 'id'>,
  providedId?: string,
  origin?: string
): string {
  const id = providedId || crypto.randomUUID()
  const workflowVariables = getWorkflowVariables(doc, variable.workflowId)
  const existingNames = workflowVariables.map((entry) => entry.name)

  const baseName =
    !variable.name || /^variable\d+$/.test(variable.name)
      ? autoGenerateVariableName(existingNames)
      : variable.name

  const uniqueName = ensureUniqueVariableName(baseName, existingNames)
  const type = coerceVariableType(variable.type)
  const value = variable.value ?? ''
  const validationError = validateVariableValue(type, value)

  const nextVariable: Variable = {
    id,
    workflowId: variable.workflowId,
    name: uniqueName,
    type: type as Variable['type'],
    value,
    ...(validationError ? { validationError } : {}),
  }

  doc.transact(() => {
    getVariablesMap(doc).set(id, nextVariable)
  }, origin ?? 'variable-add')

  return id
}

export function updateWorkflowVariable(
  doc: Y.Doc,
  id: string,
  update: Partial<Omit<Variable, 'id' | 'workflowId'>>,
  origin?: string
): boolean {
  const vMap = getVariablesMap(doc)
  const current = vMap.get(id) as Variable | undefined
  if (!current) return false

  const workflowVariables = getWorkflowVariables(doc, current.workflowId).filter(
    (variable) => variable.id !== id
  )

  let nextName = update.name ?? current.name
  if (update.name !== undefined) {
    nextName = ensureUniqueVariableName(
      update.name,
      workflowVariables.map((variable) => variable.name)
    )
  }

  const nextType = coerceVariableType(update.type ?? current.type) as Variable['type']
  const nextValue = update.value !== undefined ? update.value : current.value
  const shouldValidate = update.type !== undefined || update.value !== undefined
  const validationError = shouldValidate ? validateVariableValue(nextType, nextValue) : null

  doc.transact(() => {
    const nextVariable: Variable = {
      ...current,
      ...update,
      name: nextName,
      type: nextType,
      value: nextValue,
    }

    if (shouldValidate) {
      if (validationError) {
        nextVariable.validationError = validationError
      } else {
        delete nextVariable.validationError
      }
    } else {
      delete nextVariable.validationError
    }

    vMap.set(id, nextVariable)

    if (current.name !== nextName && current.name.trim() !== '' && nextName.trim() !== '') {
      rewriteVariableReferencesInWorkflowContent(
        getWorkflowMap(doc),
        getWorkflowTextFieldsMap(doc),
        current.name,
        nextName
      )
    }
  }, origin ?? 'variable-update')

  return true
}

export function deleteWorkflowVariable(doc: Y.Doc, id: string, origin?: string): boolean {
  const vMap = getVariablesMap(doc)
  if (!vMap.has(id)) return false

  doc.transact(() => {
    vMap.delete(id)
  }, origin ?? 'variable-delete')

  return true
}

export function duplicateWorkflowVariable(
  doc: Y.Doc,
  id: string,
  providedId?: string,
  origin?: string
): string | null {
  const current = getVariablesMap(doc).get(id) as Variable | undefined
  if (!current) return null

  const nextId = providedId || crypto.randomUUID()
  const workflowVariables = getWorkflowVariables(doc, current.workflowId)
  const baseName = `${current.name} (copy)`
  const uniqueName = ensureUniqueVariableName(
    baseName,
    workflowVariables.map((variable) => variable.name)
  )

  const duplicated: Variable = {
    id: nextId,
    workflowId: current.workflowId,
    name: uniqueName,
    type: current.type,
    value: current.value,
  }

  doc.transact(() => {
    getVariablesMap(doc).set(nextId, duplicated)
  }, origin ?? 'variable-duplicate')

  return nextId
}

export function getWorkflowVariables(doc: Y.Doc, workflowId: string): Variable[] {
  const result: Variable[] = []
  getVariablesMap(doc).forEach((value) => {
    if (value && value.workflowId === workflowId) {
      result.push(value as Variable)
    }
  })
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rewriteVariableReferencesInWorkflowContent(
  workflowMap: Y.Map<any>,
  textFields: Y.Map<any>,
  oldName: string,
  newName: string
): void {
  if (oldName === newName || oldName.trim() === '' || newName.trim() === '') return

  const normalizedOld = oldName.replace(/\s+/g, '').toLowerCase()
  const normalizedNew = newName.replace(/\s+/g, '').toLowerCase()
  const regex = new RegExp(`<variable\\.${escapeRegExp(normalizedOld)}>`, 'gi')
  const replacement = `<variable.${normalizedNew}>`

  rewriteWorkflowContentReferences(workflowMap, textFields, regex, replacement)
}
