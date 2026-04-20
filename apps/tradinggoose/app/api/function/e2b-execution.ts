import { executeInE2B, isE2BWarmSandboxLimitError } from '@/lib/execution/e2b'
import { CodeLanguage } from '@/lib/execution/languages'
import { resolveExecutionRuntimeConfig } from '@/lib/execution/runtime-config'
import { DEFAULT_INDICATOR_RUNTIME_MANIFEST } from '@/lib/indicators/default/runtime'
import { buildPineTSFunctionIndicatorRuntimePrologue } from '@/lib/indicators/execution/e2b-script-builder'
import { FUNCTION_INDICATOR_USAGE_HINT } from '@/lib/indicators/execution/function-indicator-runtime'
import { formatE2BError } from './error-formatting'
import { executeFunctionInLocalVm } from './local-execution'
import { extractJavaScriptImports } from './typescript-utils'

const E2B_JS_WRAPPER_LINES = 3

type ExecuteFunctionInE2BArgs = {
  transpiledCode: string
  resolvedCode: string
  executionParams: Record<string, any>
  envVars: Record<string, string>
  contextVariables: Record<string, any>
  isCustomTool: boolean
  timeout: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
  e2bUserScope?: string
  onImportExtractionError?: (error: unknown) => void
  onSandboxResult?: (meta: { sandboxId?: string; stdoutPreview?: string; error?: string }) => void
}

export const executeFunctionInE2B = async ({
  transpiledCode,
  resolvedCode,
  executionParams,
  envVars,
  contextVariables,
  isCustomTool,
  timeout,
  e2bTemplate,
  e2bKeepWarmMs,
  e2bUserScope,
  onImportExtractionError,
  onSandboxResult,
}: ExecuteFunctionInE2BArgs): Promise<
  | { success: true; result: unknown; stdout: string; executionTime: number }
  | { success: false; error: string; stdout: string; executionTime: number }
> => {
  let prologue = ''
  let prologueLineCount = 0

  const { imports, remainingCode, importLineCount } = await extractJavaScriptImports(
    transpiledCode,
    onImportExtractionError
  )
  const importSection = imports ? `${imports}\n` : ''
  const codeBody = remainingCode

  prologue += `const params = JSON.parse(${JSON.stringify(JSON.stringify(executionParams))});\n`
  prologueLineCount++
  if (isCustomTool) {
    Object.keys(executionParams).forEach((key) => {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return
      prologue += `const ${key} = params[${JSON.stringify(key)}];\n`
      prologueLineCount++
    })
  }
  prologue += `const environmentVariables = JSON.parse(${JSON.stringify(JSON.stringify(envVars))});\n`
  prologueLineCount++

  for (const [k, v] of Object.entries(contextVariables)) {
    prologue += `const ${k} = JSON.parse(${JSON.stringify(JSON.stringify(v))});\n`
    prologueLineCount++
  }

  const indicatorRuntimePrologue = buildPineTSFunctionIndicatorRuntimePrologue({
    manifest: DEFAULT_INDICATOR_RUNTIME_MANIFEST,
    usageHint: FUNCTION_INDICATOR_USAGE_HINT,
  })
  prologue += `${indicatorRuntimePrologue}\n`
  prologueLineCount += indicatorRuntimePrologue.split('\n').length

  const wrapped = [
    ';(async () => {',
    '  try {',
    '    const __tg_result = await (async () => {',
    `      ${codeBody.split('\n').join('\n      ')}`,
    '    })();',
    "    console.log('__TG_RESULT__=' + JSON.stringify(__tg_result));",
    '  } catch (error) {',
    '    console.log(String((error && (error.stack || error.message)) || error));',
    '    throw error;',
    '  }',
    '})();',
  ].join('\n')

  const codeForE2B = importSection + prologue + wrapped
  const execStart = Date.now()

  const {
    result: e2bResult,
    stdout: e2bStdout,
    sandboxId,
    error: e2bError,
  } = await executeInE2B({
    code: codeForE2B,
    language: CodeLanguage.JavaScript,
    timeoutMs: timeout,
    template: e2bTemplate,
    keepWarmMs: e2bKeepWarmMs,
    userScope: e2bUserScope,
  })

  const executionTime = Date.now() - execStart
  onSandboxResult?.({
    sandboxId,
    stdoutPreview: e2bStdout?.slice(0, 200),
    error: e2bError,
  })

  if (e2bError) {
    const { formattedError, cleanedOutput } = formatE2BError(
      e2bError,
      resolvedCode,
      prologueLineCount + importLineCount,
      E2B_JS_WRAPPER_LINES
    )

    return {
      success: false,
      error: formattedError,
      stdout: cleanedOutput,
      executionTime,
    }
  }

  return {
    success: true,
    result: e2bResult ?? null,
    stdout: e2bStdout,
    executionTime,
  }
}

type ExecuteFunctionWithRuntimeGateArgs = {
  requestId: string
  transpiledCode: string
  resolvedCode: string
  executionParams: Record<string, any>
  envVars: Record<string, string>
  contextVariables: Record<string, any>
  timeout: number
  isCustomTool: boolean
  e2bUserScope?: string
  onImportExtractionError?: (error: unknown) => void
  onSandboxResult?: (meta: { sandboxId?: string; stdoutPreview?: string; error?: string }) => void
  onStdout: (chunk: string) => void
  onWarn: (message: string, meta: Record<string, unknown>) => void
  onError: (message: string) => void
}

type RuntimeGateResult =
  | {
      engine: 'e2b'
      success: true
      result: unknown
      stdout: string
      executionTime: number
      userCodeStartLine: number
    }
  | {
      engine: 'e2b'
      success: false
      result: null
      stdout: string
      executionTime: number
      error: string
      userCodeStartLine: number
    }
  | {
      engine: 'local_vm'
      success: true
      result: unknown
      stdout: string
      executionTime: number
      userCodeStartLine: number
    }
  | {
      engine: 'local_vm'
      success: false
      result: null
      stdout: string
      executionTime: number
      error: string
      userCodeStartLine: number
      rawError: unknown
    }

export const executeFunctionWithRuntimeGate = async ({
  requestId,
  transpiledCode,
  resolvedCode,
  executionParams,
  envVars,
  contextVariables,
  timeout,
  isCustomTool,
  e2bUserScope,
  onImportExtractionError,
  onSandboxResult,
  onStdout,
  onWarn,
  onError,
}: ExecuteFunctionWithRuntimeGateArgs): Promise<RuntimeGateResult> => {
  const runtimeConfig = await resolveExecutionRuntimeConfig()
  const useE2B = runtimeConfig.useE2B

  if (useE2B) {
    try {
      const e2bExecution = await executeFunctionInE2B({
        transpiledCode,
        resolvedCode,
        executionParams,
        envVars,
        contextVariables,
        isCustomTool,
        timeout,
        e2bTemplate: runtimeConfig.e2bTemplate ?? undefined,
        e2bKeepWarmMs: runtimeConfig.e2bKeepWarmMs,
        e2bUserScope,
        onImportExtractionError,
        onSandboxResult,
      })

      if (e2bExecution.success) {
        return {
          engine: 'e2b',
          success: true,
          result: e2bExecution.result,
          stdout: e2bExecution.stdout,
          executionTime: e2bExecution.executionTime,
          userCodeStartLine: 3,
        }
      }

      return {
        engine: 'e2b',
        success: false,
        result: null,
        stdout: e2bExecution.stdout,
        executionTime: e2bExecution.executionTime,
        userCodeStartLine: 3,
        error: e2bExecution.error,
      }
    } catch (error) {
      if (!isE2BWarmSandboxLimitError(error)) {
        throw error
      }
      onWarn(`[${requestId}] E2B warm sandbox limit reached, falling back to local VM`, {
        error: error.message,
        activeWarmSandboxes: error.details?.activeWarmSandboxes,
        pendingWarmSandboxes: error.details?.pendingWarmSandboxes,
        maxConcurrentWarmSandboxes: error.details?.maxConcurrentWarmSandboxes,
      })
    }
  }

  const localStart = Date.now()
  try {
    const localExecution = await executeFunctionInLocalVm({
      requestId,
      transpiledCode,
      timeout,
      executionParams,
      envVars,
      contextVariables,
      isCustomTool,
      ownerKey: e2bUserScope ? `scope:${e2bUserScope}` : undefined,
      onStdout,
      onWarn,
      onError,
    })

    return {
      engine: 'local_vm',
      success: true,
      result: localExecution.result,
      stdout: '',
      executionTime: Date.now() - localStart,
      userCodeStartLine: localExecution.userCodeStartLine,
    }
  } catch (error) {
    const userLineSource = error as { __userCodeStartLine?: number } | null
    const userCodeStartLine =
      error && typeof error === 'object' && typeof userLineSource?.__userCodeStartLine === 'number'
        ? userLineSource.__userCodeStartLine
        : 3

    return {
      engine: 'local_vm',
      success: false,
      result: null,
      stdout: '',
      executionTime: Date.now() - localStart,
      userCodeStartLine,
      error: error instanceof Error ? error.message : String(error),
      rawError: error,
    }
  }
}
