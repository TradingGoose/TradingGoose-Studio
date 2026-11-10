import { checkServerSideUsageLimits } from '@/lib/billing'
import {
  acceptFinancialBusinessOperation,
  admitFinancialModelStep,
  createFinancialInvocation,
} from '@/lib/billing/native-finance'
import {
  getLocalVmSaturationLimitMessage,
  isLocalVmSaturationLimitError,
} from '@/lib/execution/local-saturation-limit'
import { listCustomIndicatorRuntimeEntries } from '@/lib/indicators/custom/operations'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { resolveCodeVariables } from '@/app/api/function/code-resolution'
import { executeFunctionWithRuntimeGate } from '@/app/api/function/e2b-execution'
import {
  createUserFriendlyErrorMessage,
  extractEnhancedError,
} from '@/app/api/function/error-formatting'
import {
  findFunctionPineDisallowedReason,
  transpileTypeScriptCode,
} from '@/app/api/function/typescript-utils'

const logger = createLogger('FunctionExecuteAPI')

export type FunctionExecutionPayload = {
  userId: string
  requestId?: string
  code: string
  params?: Record<string, unknown>
  timeout?: number
  envVars?: Record<string, string>
  blockData?: Record<string, unknown>
  blockNameMapping?: Record<string, string>
  workflowVariables?: Record<string, unknown>
  workflowId?: string | null
  workspaceId: string
  isCustomTool?: boolean
  isDeployedContext?: boolean
}

type FunctionExecutionResponseBody = {
  success: boolean
  output: {
    result: unknown
    stdout: string
    executionTime: number
  }
  error?: string
  debug?: Record<string, unknown>
}

export type FunctionExecutionResponse = {
  statusCode: number
  body: FunctionExecutionResponseBody
}

export async function executeFunctionRequest(
  payload: FunctionExecutionPayload
): Promise<FunctionExecutionResponse> {
  const requestId = payload.requestId ?? generateRequestId()
  const startTime = Date.now()
  let stdout = ''
  let userCodeStartLine = 3
  let resolvedCode = ''
  const buildOutput = (result: unknown, executionTime: number, outputStdout = stdout) => ({
    result,
    stdout: outputStdout,
    executionTime,
  })
  const respondSuccess = (
    result: unknown,
    executionTime: number,
    outputStdout = stdout
  ): FunctionExecutionResponse => ({
    statusCode: 200,
    body: { success: true, output: buildOutput(result, executionTime, outputStdout) },
  })
  const respondFailure = (
    error: string,
    executionTime: number,
    status = 500,
    outputStdout = stdout,
    debug?: Record<string, unknown>
  ): FunctionExecutionResponse => ({
    statusCode: status,
    body: {
      success: false,
      error,
      output: buildOutput(null, executionTime, outputStdout),
      ...(debug ? { debug } : {}),
    },
  })

  try {
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
      workspaceId,
      isCustomTool = false,
      isDeployedContext = true,
    } = payload
    const e2bUserScope = payload.userId

    const usageCheck = await checkServerSideUsageLimits({
      userId: payload.userId,
      workspaceId,
      workflowId,
    })

    if (usageCheck.isExceeded) {
      logger.warn(`[${requestId}] Function execution blocked by usage limits`, {
        userId: payload.userId,
        workflowId,
        currentUsage: usageCheck.currentUsage,
        limit: usageCheck.limit,
      })
      return respondFailure(
        usageCheck.message || 'Usage limit exceeded. Please upgrade your billing tier to continue.',
        Date.now() - startTime,
        402
      )
    }

    const executionParams = { ...params }
    executionParams._context = undefined
    const indicatorRuntimeManifest = {
      indicators: [
        ...DEFAULT_INDICATOR_RUNTIME_ENTRIES.map(({ id, pineCode, inputMeta }) => ({
          id,
          pineCode,
          inputMeta,
        })),
        ...(await listCustomIndicatorRuntimeEntries(workspaceId, isDeployedContext)),
      ],
    }

    logger.info(`[${requestId}] Function execution request`, {
      hasCode: !!code,
      paramsCount: Object.keys(executionParams).length,
      timeout,
      workflowId,
      workspaceId,
      isCustomTool,
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
    const financial = await createFinancialInvocation({
      actorUserId: payload.userId,
      workspaceId,
      workflowId,
      runId: requestId,
      operationKey: requestId,
      purpose: 'function-execution',
    })
    await admitFinancialModelStep(financial, { stepNumber: 0, retryCount: 0 })
    const runtimeExecution = await executeFunctionWithRuntimeGate({
      requestId,
      transpiledCode,
      resolvedCode,
      timeout,
      isCustomTool,
      e2bUserScope,
      executionParams,
      envVars,
      contextVariables,
      indicatorRuntimeManifest,
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

    const runtimeStdout = runtimeExecution.stdout || stdout
    stdout = runtimeStdout
    userCodeStartLine = runtimeExecution.userCodeStartLine
    const financialReceipt = await acceptFinancialBusinessOperation(financial, {
      executionTimeMs: runtimeExecution.executionTime,
    })
    const functionExecutionCost = financialReceipt.appliedUsd

    if (!runtimeExecution.success) {
      logger.warn(`[${requestId}] Function execution failed after runtime attempt`, {
        engine: runtimeExecution.engine,
        executionTime: runtimeExecution.executionTime,
        functionExecutionCost,
        error: runtimeExecution.error,
      })

      if ('rawError' in runtimeExecution) {
        if (isLocalVmSaturationLimitError(runtimeExecution.rawError)) {
          throw runtimeExecution.rawError
        }

        const enhancedError = extractEnhancedError(
          runtimeExecution.rawError,
          userCodeStartLine,
          resolvedCode
        )
        const userFriendlyErrorMessage = createUserFriendlyErrorMessage(enhancedError, resolvedCode)

        logger.error(`[${requestId}] Enhanced error details`, {
          originalMessage: runtimeExecution.error,
          enhancedMessage: userFriendlyErrorMessage,
          line: enhancedError.line,
          column: enhancedError.column,
          lineContent: enhancedError.lineContent,
          errorType: enhancedError.name,
          userCodeStartLine,
          functionExecutionCost,
        })

        return respondFailure(
          userFriendlyErrorMessage,
          runtimeExecution.executionTime,
          500,
          runtimeStdout,
          {
            line: enhancedError.line,
            column: enhancedError.column,
            errorType: enhancedError.name,
            lineContent: enhancedError.lineContent,
          }
        )
      }

      return respondFailure(
        runtimeExecution.error || 'Function execution failed',
        runtimeExecution.executionTime,
        500,
        runtimeStdout
      )
    }

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Function executed successfully`, {
      executionTime,
      engine: runtimeExecution.engine,
      functionExecutionCost,
    })

    return respondSuccess(runtimeExecution.result, executionTime)
  } catch (error: any) {
    if (isLocalVmSaturationLimitError(error)) {
      return respondFailure(
        getLocalVmSaturationLimitMessage(error),
        Date.now() - startTime,
        error.statusCode
      )
    }

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
