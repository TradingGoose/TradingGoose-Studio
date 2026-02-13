import { executeInE2B } from '@/lib/execution/e2b'
import { CodeLanguage } from '@/lib/execution/languages'
import { DEFAULT_INDICATOR_RUNTIME_MANIFEST } from '@/lib/indicators/default/runtime'
import { buildPineTSFunctionIndicatorRuntimePrologue } from '@/lib/indicators/execution/e2b-script-builder'
import { FUNCTION_INDICATOR_USAGE_HINT } from '@/lib/indicators/execution/function-indicator-runtime'
import { formatE2BError } from './error-formatting'
import { extractJavaScriptImports } from './typescript-utils'

const E2B_JS_WRAPPER_LINES = 3

type ExecuteFunctionInE2BArgs = {
  transpiledCode: string
  resolvedCode: string
  executionParams: Record<string, any>
  envVars: Record<string, string>
  contextVariables: Record<string, any>
  timeout: number
  e2bTemplate?: string
  e2bKeepWarmMs?: number
  onImportExtractionError?: (error: unknown) => void
  onSandboxResult?: (meta: { sandboxId?: string; stdoutPreview?: string; error?: string }) => void
}

export const executeFunctionInE2B = async ({
  transpiledCode,
  resolvedCode,
  executionParams,
  envVars,
  contextVariables,
  timeout,
  e2bTemplate,
  e2bKeepWarmMs,
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
