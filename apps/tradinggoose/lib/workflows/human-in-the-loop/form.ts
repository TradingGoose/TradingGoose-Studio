import { ListingIdentitySchema } from '@/lib/listing/identity'
import type { WorkflowPauseInputField } from '@/lib/workflows/human-in-the-loop/types'
import { WORKFLOW_FIELD_TYPES } from '@/lib/workflows/value-types'

const FIELD_TYPES = new Set(WORKFLOW_FIELD_TYPES)
const RESERVED_NAMES = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'url',
  'resumeEndpoint',
  'error',
  'kind',
  'stream',
  'execution',
  'response',
])

export function normalizeWorkflowPauseInputFormat(value: unknown): WorkflowPauseInputField[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Resume form must contain at most 100 fields')
  const names = new Set<string>()
  return value.flatMap((field) => {
    if (
      !field ||
      typeof field !== 'object' ||
      Array.isArray(field) ||
      typeof field.name !== 'string'
    ) {
      throw new Error('Resume fields must have string names')
    }
    const name = field.name.trim()
    if (!name) return []
    if (
      name.length > 100 ||
      /[\x00-\x1F"\\]/.test(name) ||
      RESERVED_NAMES.has(name) ||
      names.has(name)
    ) {
      throw new Error(`Invalid or duplicate resume field name: ${name}`)
    }
    names.add(name)
    const type = field.type ?? 'string'
    if (!FIELD_TYPES.has(type)) throw new Error(`Unsupported resume field type: ${type}`)
    return [
      {
        name,
        type,
        required: field.required === true,
        ...(typeof field.description === 'string' ? { description: field.description } : {}),
        ...(field.value !== undefined ? { value: field.value } : {}),
      },
    ]
  })
}

export function validateWorkflowPauseInput(
  fields: WorkflowPauseInputField[],
  input: unknown
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Resume input must be an object')
  if (JSON.stringify(input).length > 256_000) throw new Error('Resume input is too large')
  const record = input as Record<string, unknown>
  const names = new Set(fields.map((field) => field.name))
  for (const key of Object.keys(record)) {
    if (!names.has(key) || RESERVED_NAMES.has(key)) throw new Error(`Unknown resume field: ${key}`)
  }
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    const value = Object.hasOwn(record, field.name) ? record[field.name] : undefined
    if (value === undefined || value === null || (field.required && value === '')) {
      if (field.required) throw new Error(`${field.name} is required`)
      continue
    }
    let valid = false
    switch (field.type) {
      case 'string':
        valid = typeof value === 'string'
        break
      case 'number':
        valid = typeof value === 'number' && Number.isFinite(value)
        break
      case 'boolean':
        valid = typeof value === 'boolean'
        break
      case 'object':
        valid = typeof value === 'object' && !Array.isArray(value)
        break
      case 'array':
        valid = Array.isArray(value)
        break
      case 'files':
        valid =
          Array.isArray(value) &&
          value.every(
            (file) =>
              file &&
              typeof file === 'object' &&
              ['id', 'name', 'url', 'type', 'key', 'uploadedAt', 'expiresAt'].every(
                (key) => typeof file[key] === 'string'
              ) &&
              typeof file.size === 'number' &&
              Number.isFinite(file.size) &&
              file.size >= 0 &&
              (file.context === undefined || typeof file.context === 'string')
          )
        break
      case 'listingIdentity': {
        const parsed = ListingIdentitySchema.safeParse(value)
        if (parsed.success) {
          result[field.name] = parsed.data
          continue
        }
        break
      }
    }
    if (!valid) throw new Error(`${field.name} must be ${field.type}`)
    result[field.name] = value
  }
  return result
}
