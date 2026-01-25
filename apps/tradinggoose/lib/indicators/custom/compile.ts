import type { IndicatorTemplate, KLineData } from 'klinecharts'
import * as ts from 'typescript'
import {
  buildFigureStyles,
  buildPlotRows,
  normalizeIndicatorOutput,
  type NormalizedIndicatorOutput,
} from '@/lib/indicators/shared/output'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'

export type {
  IndicatorOutput,
  IndicatorPlot,
  IndicatorSignal,
  NormalizedIndicatorOutput,
} from '@/lib/indicators/shared/output'

export const looksLikeFunctionExpression = (code: string): boolean => {
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

export type IndicatorExecutionContext = {
  dataList: KLineData[]
  indicator: CustomIndicatorDefinition
}

export type IndicatorExecutionError = {
  message: string
  line?: number
  column?: number
  stack?: string
}

export type IndicatorExecutorResult = {
  result?: unknown
  error?: IndicatorExecutionError
}

export type IndicatorExecutor = (args: {
  code: string
  context: IndicatorExecutionContext
}) => IndicatorExecutorResult

export type IndicatorCompileResult = {
  template: IndicatorTemplate | null
  output: NormalizedIndicatorOutput | null
  errors: string[]
}

export type IndicatorCompileOutput = {
  output: NormalizedIndicatorOutput | null
  errors: string[]
  rawResult?: unknown
  transpiledCode?: string
  executionError?: IndicatorExecutionError
}

export const transpileTypeScript = (code: string): { code: string; error?: string } => {
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

const executeWithFunction: IndicatorExecutor = ({ code, context }) => {
  const calcResult = compileFunction(code, ['dataList', 'indicator'])
  if (!calcResult.fn) {
    return {
      error: {
        message: calcResult.error ?? 'failed to compile',
      },
    }
  }

  try {
    return { result: (calcResult.fn as Function)(context.dataList, context.indicator) }
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    }
  }
}

export function compileIndicatorOutput(
  indicator: CustomIndicatorDefinition,
  dataList: KLineData[],
  executor: IndicatorExecutor = executeWithFunction
): IndicatorCompileOutput {
  if (isIndicatorDraft(indicator)) {
    return { output: null, errors: ['Draft indicator'] }
  }

  const errors: string[] = []
  const transpiledCalc = transpileTypeScript(indicator.calcCode ?? '')
  if (transpiledCalc.error) {
    errors.push(`calc: typescript ${transpiledCalc.error}`)
    return { output: null, errors, transpiledCode: transpiledCalc.code }
  }

  const transpiledCode = transpiledCalc.code.trim()
  if (!transpiledCode) {
    errors.push('calc: empty code')
    return { output: null, errors, transpiledCode: transpiledCalc.code }
  }

  const execResult = executor({
    code: transpiledCalc.code,
    context: { dataList, indicator },
  })

  if (execResult.error) {
    errors.push(`calc: ${execResult.error.message}`)
    return {
      output: null,
      errors,
      transpiledCode: transpiledCalc.code,
      executionError: execResult.error,
    }
  }

  const normalizedOutput = normalizeIndicatorOutput(execResult.result, dataList.length)

  return {
    output: normalizedOutput,
    errors,
    rawResult: execResult.result,
    transpiledCode: transpiledCalc.code,
  }
}

export function buildIndicatorTemplate(
  indicator: CustomIndicatorDefinition,
  dataList: KLineData[]
): IndicatorCompileResult {
  const compiledOutput = compileIndicatorOutput(indicator, dataList)
  const errors = [...compiledOutput.errors]

  if (!compiledOutput.output) {
    return { template: null, output: null, errors }
  }

  const calcResult = compileFunction(compiledOutput.transpiledCode ?? '', [
    'dataList',
    'indicator',
  ])
  if (!calcResult.fn) {
    errors.push(calcResult.error ? `calc: ${calcResult.error}` : 'calc: failed to compile')
    return { template: null, output: compiledOutput.output, errors }
  }

  const normalizedOutput = compiledOutput.output

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
        const result = (calcResult.fn as Function)(klineDataList, indicator)
        const normalized = normalizeIndicatorOutput(result, klineDataList.length)
        return buildPlotRows(normalized.plots, klineDataList.length)
      } catch {
        return []
      }
    },
  }

  return { template, output: normalizedOutput, errors }
}
