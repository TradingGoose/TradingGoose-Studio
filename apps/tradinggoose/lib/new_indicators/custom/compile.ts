import { Script, createContext } from 'vm'
import type { BarMs, NormalizedPineOutput, PineWarning, PineUnsupportedInfo } from '@/lib/new_indicators/types'
import { normalizeIndicatorCode } from '@/lib/new_indicators/normalize-indicator-code'
import { runPineTS } from '@/lib/new_indicators/run-pinets'
import { normalizeContext } from '@/lib/new_indicators/normalize-context'
import { detectUnsupportedFeatures } from '@/lib/new_indicators/unsupported'
import { buildIndexMaps, normalizeBarsMs } from '@/lib/new_indicators/series-data'

export type PineExecutionError = {
  message: string
  line?: number
  column?: number
  stack?: string
}

export type PineCompileResult = {
  output: NormalizedPineOutput | null
  warnings: PineWarning[]
  unsupported: PineUnsupportedInfo
  transpiledCode?: string
  executionError?: PineExecutionError
  unsupportedFeatures?: string[]
}

const parseExecutionError = (error: unknown, lineOffset: number): PineExecutionError => {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  let line: number | undefined
  let column: number | undefined

  if (stack) {
    const match = stack.match(/indicator-code\.js:(\d+):(\d+)/)
    if (match) {
      const parsedLine = Number.parseInt(match[1] ?? '', 10)
      const parsedColumn = Number.parseInt(match[2] ?? '', 10)
      if (Number.isFinite(parsedLine)) {
        const adjustedLine = parsedLine - lineOffset
        if (adjustedLine > 0) {
          line = adjustedLine
          column = Number.isFinite(parsedColumn) ? parsedColumn : undefined
        }
      }
    }
  }

  return { message, line, column, stack }
}

const createVmFunction = (code: string): Function => {
  const sandbox = {
    Math,
    Date,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  }
  const vmContext = createContext(sandbox)
  const script = new Script(`(${code})`, { filename: 'indicator-code.js' })
  const fn = script.runInContext(vmContext)
  if (typeof fn !== 'function') {
    throw new Error('Expected a function expression')
  }
  return fn as Function
}

export async function compilePineIndicator({
  pineCode,
  barsMs,
  inputsMap,
  listingKey,
  interval,
  intervalMs,
}: {
  pineCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
  interval?: string
  intervalMs?: number | null
}): Promise<PineCompileResult> {
  const unsupportedFeatures = detectUnsupportedFeatures(pineCode)
  if (unsupportedFeatures.length > 0) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      unsupportedFeatures,
    }
  }

  const normalizedBars = normalizeBarsMs(barsMs, intervalMs)
  const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(normalizedBars)
  const normalizedCode = normalizeIndicatorCode(pineCode)

  if (normalizedCode.error) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode: normalizedCode.transpiledCode,
      executionError: { message: normalizedCode.error },
    }
  }

  if (!normalizedCode.code) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode: normalizedCode.transpiledCode,
      executionError: { message: 'empty code' },
    }
  }

  let executionError: PineExecutionError | undefined
  let pineContext: any
  let transpiledCode: string | undefined

  try {
    const fn = createVmFunction(normalizedCode.code)
    const result = await runPineTS({
      barsMs: normalizedBars,
      inputsMap,
      listingKey,
      interval,
      code: fn,
    })
    pineContext = result.context
    transpiledCode =
      typeof result.transpiledCode === 'string' ? result.transpiledCode : undefined
  } catch (error) {
    executionError = parseExecutionError(error, 0)
  }

  if (!pineContext || executionError) {
    return {
      output: null,
      warnings: [],
      unsupported: { plots: [], styles: [] },
      transpiledCode,
      executionError: executionError ?? { message: 'Failed to execute PineTS code.' },
    }
  }

  const normalized = normalizeContext({
    context: pineContext,
    indexByOpenTimeMs,
    openTimeMsByIndex,
  })

  return {
    output: normalized.output,
    warnings: normalized.warnings,
    unsupported: normalized.output.unsupported,
    transpiledCode,
  }
}

