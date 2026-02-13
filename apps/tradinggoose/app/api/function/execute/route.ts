import { type NextRequest, NextResponse } from 'next/server'
import { resolveIndicatorRuntimeConfig } from '@/lib/indicators/runtime-config'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { resolveCodeVariables } from '../code-resolution'
import { executeFunctionInE2B } from '../e2b-execution'
import { createUserFriendlyErrorMessage, extractEnhancedError } from '../error-formatting'
import { executeFunctionInLocalVm } from '../local-execution'
import { findFunctionPineDisallowedReason, transpileTypeScriptCode } from '../typescript-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 210

const logger = createLogger('FunctionExecuteAPI')

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3
  let resolvedCode = ''
  const buildOutput = (result: unknown, executionTime: number, outputStdout = stdout) => ({
    result,
    stdout: outputStdout,
    executionTime,
  })
  const respondSuccess = (result: unknown, executionTime: number, outputStdout = stdout) =>
    NextResponse.json({ success: true, output: buildOutput(result, executionTime, outputStdout) })
  const respondFailure = (
    error: string,
    executionTime: number,
    status = 500,
    outputStdout = stdout,
    debug?: Record<string, unknown>
  ) =>
    NextResponse.json(
      {
        success: false,
        error,
        output: buildOutput(null, executionTime, outputStdout),
        ...(debug ? { debug } : {}),
      },
      { status }
    )

  try {
    const body = await req.json()
    const { DEFAULT_EXECUTION_TIMEOUT_MS } = await import('@/lib/execution/constants')

    const {
      code,
      params = {},
      timeout = DEFAULT_EXECUTION_TIMEOUT_MS,
      envVars = {},
      blockData = {},
      blockNameMapping = {},
      workflowVariables = {},
      workflowId,
      isCustomTool = false,
      useLocalVM = false,
    } = body

    const executionParams = { ...params }
    executionParams._context = undefined

    logger.info(`[${requestId}] Function execution request`, {
      hasCode: !!code,
      paramsCount: Object.keys(executionParams).length,
      timeout,
      workflowId,
      isCustomTool,
      useLocalVM,
    })

    const { resolvedCode: nextResolvedCode, contextVariables } = resolveCodeVariables(
      code,
      executionParams,
      envVars,
      blockData,
      blockNameMapping,
      workflowVariables
    )
    resolvedCode = nextResolvedCode

    const disallowedPineUsageReason = await findFunctionPineDisallowedReason(resolvedCode)
    if (disallowedPineUsageReason) {
      return respondFailure(disallowedPineUsageReason, Date.now() - startTime, 400)
    }

    const transpiledCode = await transpileTypeScriptCode(resolvedCode)
    const indicatorRuntimeConfig = resolveIndicatorRuntimeConfig()
    const useE2B = indicatorRuntimeConfig.useE2B && !isCustomTool && !useLocalVM

    if (useE2B) {
      logger.info(`[${requestId}] E2B status`, {
        enabled: indicatorRuntimeConfig.useE2B,
        template: indicatorRuntimeConfig.e2bTemplate,
        keepWarmMs: indicatorRuntimeConfig.e2bKeepWarmMs,
      })

      const e2bExecution = await executeFunctionInE2B({
        transpiledCode,
        resolvedCode,
        executionParams,
        envVars,
        contextVariables,
        timeout,
        e2bTemplate: indicatorRuntimeConfig.e2bTemplate,
        e2bKeepWarmMs: indicatorRuntimeConfig.e2bKeepWarmMs,
        onImportExtractionError: (error) => {
          logger.error('Failed to extract JavaScript imports', { error })
        },
        onSandboxResult: ({ sandboxId, stdoutPreview, error }) => {
          logger.info(`[${requestId}] E2B JS sandbox`, {
            sandboxId,
            stdoutPreview,
            error,
          })
        },
      })

      stdout = e2bExecution.stdout
      if (!e2bExecution.success) {
        return respondFailure(
          e2bExecution.error,
          e2bExecution.executionTime,
          500,
          e2bExecution.stdout
        )
      }

      return respondSuccess(e2bExecution.result ?? null, e2bExecution.executionTime)
    }

    const localExecution = await executeFunctionInLocalVm({
      requestId,
      transpiledCode,
      timeout,
      executionParams,
      envVars,
      contextVariables,
      isCustomTool,
      onStdout: (chunk) => {
        stdout += chunk
      },
      onWarn: (message, meta) => {
        logger.warn(message, meta)
      },
      onError: (message) => {
        logger.error(`[${requestId}] Code Console Error: ${message}`)
      },
    })
    userCodeStartLine = localExecution.userCodeStartLine

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Function executed successfully using vm`, {
      executionTime,
    })

    return respondSuccess(localExecution.result, executionTime)
  } catch (error: any) {
    const executionTime = Date.now() - startTime
    const userLineFromError =
      error && typeof error === 'object' && typeof error.__userCodeStartLine === 'number'
        ? error.__userCodeStartLine
        : undefined
    if (typeof userLineFromError === 'number') {
      userCodeStartLine = userLineFromError
    }

    logger.error(`[${requestId}] Function execution failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
      executionTime,
    })

    const enhancedError = extractEnhancedError(error, userCodeStartLine, resolvedCode)
    const userFriendlyErrorMessage = createUserFriendlyErrorMessage(enhancedError, resolvedCode)

    logger.error(`[${requestId}] Enhanced error details`, {
      originalMessage: error.message,
      enhancedMessage: userFriendlyErrorMessage,
      line: enhancedError.line,
      column: enhancedError.column,
      lineContent: enhancedError.lineContent,
      errorType: enhancedError.name,
      userCodeStartLine,
    })

    return respondFailure(userFriendlyErrorMessage, executionTime, 500, stdout, {
      line: enhancedError.line,
      column: enhancedError.column,
      errorType: enhancedError.name,
      lineContent: enhancedError.lineContent,
      stack: enhancedError.stack,
    })
  }
}
