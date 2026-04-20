import type { InputMeta, InputMetaMap } from '@/lib/indicators/types'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const INPUT_TYPES = [
  'any',
  'int',
  'float',
  'bool',
  'string',
  'timeframe',
  'time',
  'price',
  'session',
  'source',
  'symbol',
  'text_area',
  'enum',
  'color',
] as const

const INPUT_CALL_PATTERN = new RegExp(`\\binput\\.(${INPUT_TYPES.join('|')})\\s*\\(`, 'g')

const parseLiteral = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : undefined
}

const findMatchingParen = (code: string, openIndex: number) => {
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let isEscaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = openIndex + 1; i < code.length; i += 1) {
    const char = code[i]
    const next = code[i + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (inSingle) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === "'") {
        inSingle = false
      }
      continue
    }

    if (inDouble) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }

    if (inTemplate) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === '`') {
        inTemplate = false
      }
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    if (char === "'") {
      inSingle = true
      continue
    }

    if (char === '"') {
      inDouble = true
      continue
    }

    if (char === '`') {
      inTemplate = true
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')') {
      if (depth === 0) {
        return i
      }
      depth -= 1
    }
  }

  return -1
}

const parseInputCalls = (code: string): Array<{ type: string; argsRaw: string }> => {
  const matches: Array<{ type: string; argsRaw: string }> = []
  INPUT_CALL_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = INPUT_CALL_PATTERN.exec(code)) !== null) {
    const type = match[1] ?? ''
    const openIndex = match.index + match[0].length - 1
    const closeIndex = findMatchingParen(code, openIndex)
    if (closeIndex === -1) continue

    matches.push({
      type,
      argsRaw: code.slice(openIndex + 1, closeIndex),
    })

    INPUT_CALL_PATTERN.lastIndex = closeIndex + 1
  }

  return matches
}

const parseInputArgs = (argsRaw: string): string[] => {
  const args: string[] = []
  let current = ''
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let isEscaped = false

  for (let i = 0; i < argsRaw.length; i += 1) {
    const char = argsRaw[i]

    if (isEscaped) {
      current += char
      isEscaped = false
      continue
    }

    if (inSingle) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === "'") {
        inSingle = false
      }
      current += char
      continue
    }

    if (inDouble) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inDouble = false
      }
      current += char
      continue
    }

    if (inTemplate) {
      if (char === '\\') {
        isEscaped = true
      } else if (char === '`') {
        inTemplate = false
      }
      current += char
      continue
    }

    if (char === "'") {
      inSingle = true
      current += char
      continue
    }

    if (char === '"') {
      inDouble = true
      current += char
      continue
    }

    if (char === '`') {
      inTemplate = true
      current += char
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      current += char
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
      current += char
      continue
    }

    if (char === ',' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) {
        args.push(trimmed)
      }
      current = ''
      continue
    }

    current += char
  }

  const trimmed = current.trim()
  if (trimmed) {
    args.push(trimmed)
  }

  return args
}

const resolveTitle = (args: string[], argsRaw: string): string | undefined => {
  const titleValue = parseLiteral(args[1] ?? '')
  if (typeof titleValue === 'string' && titleValue.trim()) {
    return titleValue.trim()
  }

  const titleMatch = argsRaw.match(/title\s*:\s*(['"])(.*?)\1/)
  if (titleMatch?.[2]?.trim()) {
    return titleMatch[2].trim()
  }

  return undefined
}

export const inferInputMetaFromPineCode = (code: string): InputMetaMap | undefined => {
  const inputMeta: InputMetaMap = {}
  const calls = parseInputCalls(code ?? '')

  for (const call of calls) {
    const type = call.type
    const argsRaw = call.argsRaw
    const args = parseInputArgs(argsRaw)
    if (args.length === 0) continue

    const titleValue = resolveTitle(args, argsRaw)
    if (!titleValue) continue

    const defval = parseLiteral(args[0] ?? '')
    const meta: InputMeta = {
      title: titleValue,
      type,
    }

    if (typeof defval !== 'undefined') {
      meta.defval = defval
    }

    const minval = parseLiteral(args[2] ?? '')
    if (typeof minval === 'number' && Number.isFinite(minval)) {
      meta.minval = minval
    }
    const maxval = parseLiteral(args[3] ?? '')
    if (typeof maxval === 'number' && Number.isFinite(maxval)) {
      meta.maxval = maxval
    }
    const step = parseLiteral(args[4] ?? '')
    if (typeof step === 'number' && Number.isFinite(step)) {
      meta.step = step
    }

    inputMeta[meta.title] = meta
  }

  return Object.keys(inputMeta).length > 0 ? inputMeta : undefined
}

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
