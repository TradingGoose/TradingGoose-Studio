import type { IndicatorTemplate, KLineData } from 'klinecharts'
import * as ts from 'typescript'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'

const looksLikeFunctionExpression = (code: string): boolean => {
  const trimmed = code.trim()
  if (!trimmed) return false
  if (/^async\s+function\b/.test(trimmed) || /^function\b/.test(trimmed)) return true
  if (/^async\s+\([^)]*\)\s*=>/.test(trimmed)) return true
  if (/^\([^)]*\)\s*=>/.test(trimmed)) return true
  if (/^async\s+[_$a-zA-Z][\w$]*\s*=>/.test(trimmed)) return true
  if (/^[_$a-zA-Z][\w$]*\s*=>/.test(trimmed)) return true
  return false
}

export function isIndicatorDraft(indicator: CustomIndicatorDefinition): boolean {
  const hasCalc = indicator.calcCode?.trim().length > 0
  return !hasCalc
}

type CompileResult = {
  fn: Function | null
  error?: string
}

export type IndicatorSignal = {
  type: 'buy' | 'sell'
  data: Array<number | null>
  text?: string
  color?: string
  textData?: Array<string | null>
}

export type IndicatorPlot = {
  key?: string
  name?: string
  data?: unknown[]
  color?: string
  type?: string
  overlay?: boolean
  style?: string
}

export type IndicatorOutput = {
  name?: string
  plots?: IndicatorPlot[] | Record<string, unknown[]>
  signals?: Array<Partial<IndicatorSignal> & { data?: unknown[]; textData?: unknown[] }>
}

type NormalizedPlot = {
  key: string
  title: string
  type: string
  color?: string
  overlay: boolean
  style?: string
  data: Array<number | null>
}

export type NormalizedIndicatorOutput = {
  name?: string
  plots: NormalizedPlot[]
  signals: IndicatorSignal[]
  allOverlay: boolean
  plotSignature: string
}

export type IndicatorCompileResult = {
  template: IndicatorTemplate | null
  output: NormalizedIndicatorOutput | null
  errors: string[]
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const normalizeSignals = (
  signals: IndicatorOutput['signals'],
  length: number
): IndicatorSignal[] => {
  if (!Array.isArray(signals) || length === 0) return []

  return signals
    .map((signal) => {
      const typeRaw = typeof signal?.type === 'string' ? signal.type.toLowerCase() : ''
      const type = typeRaw === 'sell' ? 'sell' : typeRaw === 'buy' ? 'buy' : null
      if (!type) return null

      const data = Array.isArray(signal?.data) ? signal.data : []
      const normalizedData: Array<number | null> = Array.from({ length }, (_value, i) =>
        toNumberOrNull(i < data.length ? data[i] : null)
      )

      const textData = Array.isArray(signal?.textData)
        ? signal.textData.map((value, i) => {
            if (i >= length) return null
            return typeof value === 'string' ? value : null
          })
        : undefined

      return {
        type,
        data: normalizedData,
        text: typeof signal?.text === 'string' ? signal.text : undefined,
        color: typeof signal?.color === 'string' ? signal.color : undefined,
        textData,
      } as IndicatorSignal
    })
    .filter((signal): signal is IndicatorSignal => Boolean(signal))
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const ensureUniqueKey = (base: string, used: Set<string>): string => {
  let key = base
  let suffix = 2
  while (used.has(key)) {
    key = `${base}_${suffix}`
    suffix += 1
  }
  used.add(key)
  return key
}

const normalizePlots = (plots: IndicatorPlot[] | undefined, length: number): NormalizedPlot[] => {
  if (!Array.isArray(plots) || plots.length === 0) return []

  const usedKeys = new Set<string>()

  return plots.map((plot, index) => {
    const record = plot && typeof plot === 'object' ? plot : {}
    const rawKey = typeof record.key === 'string' ? record.key.trim() : ''
    const rawName = typeof record.name === 'string' ? record.name.trim() : ''
    const title = rawName || rawKey || `Plot ${index + 1}`
    const baseKey = rawKey || slugify(title) || `plot_${index + 1}`
    const key = ensureUniqueKey(baseKey, usedKeys)
    const type =
      typeof record.type === 'string' && record.type.trim().length > 0
        ? record.type.trim()
        : 'line'
    const color = typeof record.color === 'string' && record.color.trim().length > 0 ? record.color.trim() : undefined
    const overlay = record.overlay !== false
    const style =
      typeof record.style === 'string' && record.style.trim().length > 0
        ? record.style.trim()
        : undefined
    const data = Array.isArray(record.data) ? record.data : []
    const normalizedData: Array<number | null> = Array.from({ length }, (_value, i) =>
      toNumberOrNull(i < data.length ? data[i] : null)
    )

    return {
      key,
      title,
      type,
      color,
      overlay,
      style,
      data: normalizedData,
    }
  })
}

const normalizeIndicatorOutput = (
  rawResult: unknown,
  length: number
): NormalizedIndicatorOutput => {
  let resolvedResult: unknown = rawResult
  if (typeof resolvedResult === 'string') {
    try {
      resolvedResult = JSON.parse(resolvedResult)
    } catch {
      resolvedResult = {}
    }
  }

  const output = (resolvedResult && typeof resolvedResult === 'object'
    ? (resolvedResult as IndicatorOutput)
    : {}) satisfies IndicatorOutput

  const rawPlots = Array.isArray(output.plots)
    ? output.plots
    : output.plots && typeof output.plots === 'object'
      ? Object.entries(output.plots as Record<string, unknown[]>).map(([key, data]) => ({
          key,
          data,
        }))
      : []
  const plots = normalizePlots(rawPlots, length)
  const signals = normalizeSignals(output.signals, length)
  const allOverlay = plots.length > 0 ? plots.every((plot) => plot.overlay) : false
  const plotSignature = plots
    .map((plot) =>
      `${plot.key}:${plot.type}:${plot.overlay ? '1' : '0'}:${plot.color ?? ''}:${plot.style ?? ''}`
    )
    .join('|')

  return {
    name: typeof output.name === 'string' ? output.name : undefined,
    plots,
    signals,
    allOverlay,
    plotSignature,
  }
}

const buildPlotRows = (plots: NormalizedPlot[], length: number) => {
  if (plots.length === 0 || length === 0) return [] as Array<Record<string, number | null>>

  const rows: Array<Record<string, number | null>> = Array.from({ length }, () => ({}))

  plots.forEach((plot) => {
    for (let i = 0; i < length; i += 1) {
      rows[i][plot.key] = plot.data[i] ?? null
    }
  })

  return rows
}

const transpileTypeScript = (code: string): { code: string; error?: string } => {
  if (!code) return { code: '' }
  try {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2019,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    })
    const diagnostics = result.diagnostics ?? []
    const errorMessages = diagnostics
      .filter((diag) => diag.category === ts.DiagnosticCategory.Error)
      .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, '\n'))
      .filter(Boolean)

    let output = result.outputText ?? code
    output = output.replace(/^\s*export\s*\{\s*\};?\s*$/gm, '')
    output = output.trimEnd()

    if (errorMessages.length > 0) {
      return { code: output, error: errorMessages.join('; ') }
    }

    return { code: output }
  } catch (error) {
    return {
      code,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function compileFunction(code: string, args: string[]): CompileResult {
  const trimmed = code.trim()
  if (!trimmed) return { fn: null }

  try {
    if (looksLikeFunctionExpression(trimmed)) {
      const safeExpression = trimmed.replace(/;+\s*$/, '')
      return { fn: new Function(`"use strict"; return (${safeExpression});`)() as Function }
    }

    return { fn: new Function(...args, `"use strict";\n${trimmed}`) }
  } catch (error) {
    return {
      fn: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const buildFigureStyles = (plot: NormalizedPlot) => {
  if (!plot.color && !plot.style) return undefined
  return () => {
    const styles: Record<string, unknown> = {}
    if (plot.color) {
      styles.color = plot.color
    }
    if (plot.style) {
      styles.style = plot.style
    }
    return styles
  }
}

export function buildIndicatorTemplate(
  indicator: CustomIndicatorDefinition,
  dataList: KLineData[]
): IndicatorCompileResult {
  if (isIndicatorDraft(indicator)) {
    return { template: null, output: null, errors: ['Draft indicator'] }
  }

  const errors: string[] = []
  const transpiledCalc = transpileTypeScript(indicator.calcCode ?? '')
  if (transpiledCalc.error) {
    errors.push(`calc: typescript ${transpiledCalc.error}`)
    return { template: null, output: null, errors }
  }

  const calcResult = compileFunction(transpiledCalc.code, ['dataList', 'indicator'])
  if (!calcResult.fn) {
    errors.push(calcResult.error ? `calc: ${calcResult.error}` : 'calc: failed to compile')
    return { template: null, output: null, errors }
  }

  let rawResult: unknown
  const calcFn = calcResult.fn as Function
  try {
    rawResult = calcFn(dataList, indicator)
  } catch (error) {
    errors.push(`calc: ${error instanceof Error ? error.message : String(error)}`)
    return { template: null, output: null, errors }
  }

  const normalizedOutput = normalizeIndicatorOutput(rawResult, dataList.length)

  if (normalizedOutput.plots.length === 0) {
    return { template: null, output: normalizedOutput, errors }
  }

  const figures = normalizedOutput.plots.map((plot) => {
    const styles = buildFigureStyles(plot)
    return {
      key: plot.key,
      title: plot.title,
      type: plot.type,
      ...(styles ? { styles } : {}),
    }
  })

  const template: IndicatorTemplate = {
    name: indicator.id,
    shortName: indicator.name,
    series: 'normal',
    precision: 2,
    shouldOhlc: false,
    calcParams: [],
    figures,
    calc: (klineDataList: KLineData[]) => {
      try {
        const result = calcFn(klineDataList, indicator)
        const normalized = normalizeIndicatorOutput(result, klineDataList.length)
        return buildPlotRows(normalized.plots, klineDataList.length)
      } catch {
        return []
      }
    },
  }

  return { template, output: normalizedOutput, errors }
}
