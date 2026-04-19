import ts from 'typescript'
import type { IndicatorOptions } from '@/lib/indicators/types'

export const INDICATOR_OPTION_KEYS = [
  'overlay',
  'format',
  'precision',
  'scale',
  'max_bars_back',
  'timeframe',
  'timeframe_gaps',
  'explicit_plot_zorder',
  'max_lines_count',
  'max_labels_count',
  'max_boxes_count',
  'max_polylines_count',
  'calc_bars_count',
  'dynamic_requests',
  'behind_chart',
] as const

const INDICATOR_OPTION_KEY_SET = new Set<string>(INDICATOR_OPTION_KEYS)

export const INDICATOR_DEFAULTS: Required<IndicatorOptions> = {
  overlay: false,
  format: 'inherit',
  precision: 10,
  scale: 'points',
  max_bars_back: 0,
  timeframe: '',
  timeframe_gaps: true,
  explicit_plot_zorder: false,
  max_lines_count: 50,
  max_labels_count: 50,
  max_boxes_count: 50,
  max_polylines_count: 50,
  calc_bars_count: 0,
  dynamic_requests: false,
  behind_chart: true,
}

const coerceString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  return undefined
}

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

const normalizeOptionValue = (
  key: keyof IndicatorOptions,
  value: unknown
): IndicatorOptions[keyof IndicatorOptions] | undefined => {
  if (key === 'overlay' || key === 'timeframe_gaps' || key === 'explicit_plot_zorder') {
    return coerceBoolean(value)
  }
  if (
    key === 'max_bars_back' ||
    key === 'precision' ||
    key === 'max_lines_count' ||
    key === 'max_labels_count' ||
    key === 'max_boxes_count' ||
    key === 'max_polylines_count' ||
    key === 'calc_bars_count'
  ) {
    return coerceNumber(value)
  }
  if (key === 'dynamic_requests' || key === 'behind_chart') {
    return coerceBoolean(value)
  }
  if (key === 'format' || key === 'scale' || key === 'timeframe') {
    return coerceString(value)
  }
  return undefined
}

export const normalizeIndicatorOptions = (
  raw: unknown,
  options?: { dropDefaults?: boolean }
): IndicatorOptions | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const result: IndicatorOptions = {}
  const dropDefaults = options?.dropDefaults ?? false

  INDICATOR_OPTION_KEYS.forEach((key) => {
    const value = normalizeOptionValue(
      key as keyof IndicatorOptions,
      (raw as Record<string, unknown>)[key]
    )
    if (typeof value === 'undefined') return
    if (dropDefaults) {
      const defaultValue = INDICATOR_DEFAULTS[key as keyof IndicatorOptions]
      if (value === defaultValue) return
      if (typeof value === 'string' && value.trim() === '' && defaultValue === '') return
    }
    ;(result as Record<string, unknown>)[key] = value
  })

  return Object.keys(result).length > 0 ? result : undefined
}

const resolveLiteralValue = (node: ts.Expression): unknown => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text)
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return -Number(node.operand.text)
    }
    if (node.operator === ts.SyntaxKind.PlusToken && ts.isNumericLiteral(node.operand)) {
      return Number(node.operand.text)
    }
  }
  return undefined
}

const parseIndicatorOptionsFromObject = (
  node: ts.ObjectLiteralExpression
): IndicatorOptions | undefined => {
  const result: IndicatorOptions = {}
  node.properties.forEach((prop) => {
    if (!ts.isPropertyAssignment(prop)) return
    let key: string | undefined
    if (ts.isIdentifier(prop.name)) {
      key = prop.name.text
    } else if (ts.isStringLiteral(prop.name)) {
      key = prop.name.text
    }
    if (!key || !INDICATOR_OPTION_KEY_SET.has(key)) return
    const value = resolveLiteralValue(prop.initializer)
    if (typeof value === 'undefined') return
    const normalized = normalizeOptionValue(key as keyof IndicatorOptions, value)
    if (typeof normalized === 'undefined') return
    ;(result as Record<string, unknown>)[key] = normalized
  })
  return Object.keys(result).length > 0 ? result : undefined
}

export const inferIndicatorOptionsFromPineCode = (code: string): IndicatorOptions | undefined => {
  if (!code || code.trim().length === 0) return undefined
  const sourceFile = ts.createSourceFile(
    'indicator.ts',
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX
  )
  let inferred: IndicatorOptions | undefined

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'indicator') {
        const args = node.arguments
        if (args.length > 0) {
          const lastArg = args[args.length - 1]
          if (ts.isObjectLiteralExpression(lastArg)) {
            const parsed = parseIndicatorOptionsFromObject(lastArg)
            if (parsed) {
              inferred = parsed
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return inferred
}

const parseNumericTimeframe = (value: string): number | null => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric
}

export const resolveIndicatorTimeframeMs = (timeframe?: string | null): number | null => {
  if (!timeframe) return null
  const raw = timeframe.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'd') return 24 * 60 * 60 * 1000
  if (lower === 'w') return 7 * 24 * 60 * 60 * 1000
  if (raw === 'M' || lower === 'mo') return 30 * 24 * 60 * 60 * 1000

  if (/^\d+$/.test(raw)) {
    const minutes = parseNumericTimeframe(raw)
    return minutes ? minutes * 60 * 1000 : null
  }

  const match = raw.match(/^(\d+)([a-zA-Z]+)$/)
  if (!match) return null
  const value = parseNumericTimeframe(match[1] ?? '')
  if (!value) return null
  const unit = match[2] ?? ''
  const unitLower = unit.toLowerCase()
  if (unitLower === 's') return null
  if (unitLower === 'm') return value * 60 * 1000
  if (unitLower === 'h') return value * 60 * 60 * 1000
  if (unitLower === 'd') return value * 24 * 60 * 60 * 1000
  if (unitLower === 'w') return value * 7 * 24 * 60 * 60 * 1000
  if (unitLower === 'mo' || unit === 'M') return value * 30 * 24 * 60 * 60 * 1000
  return null
}

export const coerceIndicatorCount = (value?: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.trunc(value)
  return rounded > 0 ? rounded : null
}
