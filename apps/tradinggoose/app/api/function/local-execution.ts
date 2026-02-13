import { createContext, Script } from 'vm'
import { createFunctionIndicatorRuntime } from '@/lib/indicators/execution/function-indicator-runtime'
import { validateProxyUrl } from '@/lib/security/input-validation'

type LocalExecutionArgs = {
  requestId: string
  transpiledCode: string
  timeout: number
  executionParams: Record<string, any>
  envVars: Record<string, string>
  contextVariables: Record<string, any>
  isCustomTool: boolean
  onStdout: (chunk: string) => void
  onWarn: (message: string, meta: Record<string, unknown>) => void
  onError: (message: string) => void
}

const createSecureFetch = (
  requestId: string,
  onWarn: (message: string, meta: Record<string, unknown>) => void
) => {
  const originalFetch = (globalThis as any).fetch || require('node-fetch').default

  return async function secureFetch(input: any, init?: any) {
    const url = typeof input === 'string' ? input : input?.url || input

    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided to fetch')
    }

    const validation = validateProxyUrl(url)
    if (!validation.isValid) {
      onWarn(`[${requestId}] Blocked fetch request due to SSRF validation`, {
        url: url.substring(0, 100),
        error: validation.error,
      })
      throw new Error(`Security Error: ${validation.error}`)
    }

    return originalFetch(input, init)
  }
}

export const executeFunctionInLocalVm = async ({
  requestId,
  transpiledCode,
  timeout,
  executionParams,
  envVars,
  contextVariables,
  isCustomTool,
  onStdout,
  onWarn,
  onError,
}: LocalExecutionArgs): Promise<{ result: unknown; userCodeStartLine: number }> => {
  const indicator = createFunctionIndicatorRuntime({
    requestId,
    onWarn,
  })
  const context = createContext({
    params: executionParams,
    environmentVariables: envVars,
    ...contextVariables,
    indicator,
    fetch: createSecureFetch(requestId, onWarn),
    console: {
      log: (...args: any[]) => {
        const logMessage = `${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
          .join(' ')}\n`
        onStdout(logMessage)
      },
      error: (...args: any[]) => {
        const errorMessage = `${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
          .join(' ')}\n`
        onError(errorMessage)
        onStdout(`ERROR: ${errorMessage}`)
      },
    },
  })

  const wrapperLines = ['(async () => {', '  try {']
  if (isCustomTool) {
    wrapperLines.push('    // For custom tools, make parameters directly accessible')
    Object.keys(executionParams).forEach((key) => {
      wrapperLines.push(`    const ${key} = params.${key};`)
    })
  }
  const userCodeStartLine = wrapperLines.length + 1
  const fullScript = [
    ...wrapperLines,
    `    ${transpiledCode.split('\n').join('\n    ')}`,
    '  } catch (error) {',
    '    console.error(error);',
    '    throw error;',
    '  }',
    '})()',
  ].join('\n')

  const script = new Script(fullScript, {
    filename: 'user-function.js',
    lineOffset: 0,
    columnOffset: 0,
  })

  try {
    const result = await script.runInContext(context, {
      timeout,
      displayErrors: true,
      breakOnSigint: true,
    })
    return { result, userCodeStartLine }
  } catch (error) {
    if (error && typeof error === 'object') {
      ;(error as { __userCodeStartLine?: number }).__userCodeStartLine = userCodeStartLine
    }
    throw error
  }
}
