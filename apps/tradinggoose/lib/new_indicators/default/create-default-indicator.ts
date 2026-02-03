import type { InputMeta, InputMetaMap } from '@/lib/new_indicators/types'

export type DefaultPineIndicatorDefinition = {
  id: string
  name: string
  pineCode: string
  inputMeta?: InputMetaMap
}

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

const parseInputArgs = (argsRaw: string): string[] =>
  argsRaw
    .split(',')
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0)

const inferInputMetaFromPineCode = (code: string): InputMetaMap | undefined => {
  const inputMeta: InputMetaMap = {}
  const inputPattern = /input\.(int|float|bool|string)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null

  while ((match = inputPattern.exec(code)) !== null) {
    const type = match[1] ?? ''
    const argsRaw = match[2] ?? ''
    const args = parseInputArgs(argsRaw)
    if (args.length === 0) continue
    const defval = parseLiteral(args[0] ?? '')
    const titleValue = parseLiteral(args[1] ?? '')
    if (typeof titleValue !== 'string' || !titleValue.trim()) continue

    const meta: InputMeta = {
      title: titleValue.trim(),
      type,
      defval,
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

export const createDefaultPineIndicator = (definition: DefaultPineIndicatorDefinition) => {
  if (definition.inputMeta) return definition
  const inferredInputMeta = inferInputMetaFromPineCode(definition.pineCode)
  if (!inferredInputMeta) return definition
  return {
    ...definition,
    inputMeta: inferredInputMeta,
  }
}
