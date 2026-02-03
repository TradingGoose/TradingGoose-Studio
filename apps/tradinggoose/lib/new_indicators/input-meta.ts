import type { InputMeta, InputMetaMap } from '@/lib/new_indicators/types'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const normalizeInputMetaMap = (value: unknown): InputMetaMap | undefined => {
  if (!isPlainObject(value)) return undefined
  const result: InputMetaMap = {}

  Object.entries(value).forEach(([key, meta]) => {
    if (!meta || typeof meta !== 'object') return
    const title = typeof (meta as InputMeta).title === 'string' ? (meta as InputMeta).title : key
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    result[trimmedTitle] = {
      ...(meta as InputMeta),
      title: trimmedTitle,
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

const coerceValue = (meta: InputMeta, value: unknown) => {
  if (meta.type === 'int' || meta.type === 'float') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return meta.type === 'int' ? Math.trunc(parsed) : parsed
      }
    }
    return meta.defval
  }

  if (meta.type === 'bool') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true
      if (value.toLowerCase() === 'false') return false
    }
    return meta.defval ?? false
  }

  return value ?? meta.defval
}

export const buildInputsMapFromMeta = (
  inputMeta: InputMetaMap | undefined,
  overrides?: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  const entries = inputMeta ? Object.entries(inputMeta) : []

  entries.forEach(([title, meta]) => {
    if (!meta || !title.trim()) return
    const overrideValue = overrides ? overrides[title] : undefined
    const resolved = coerceValue(meta, overrideValue ?? meta.value ?? meta.defval)
    if (typeof resolved !== 'undefined') {
      result[title] = resolved
    }
  })

  return result
}

