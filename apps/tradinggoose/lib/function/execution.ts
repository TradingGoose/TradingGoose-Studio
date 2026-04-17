import { checkServerSideUsageLimits } from '@/lib/billing'
import { getResolvedBillingSettings, isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierFunctionExecutionDurationMultiplier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import {
  getExecutionConcurrencyLimitMessage,
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
  withExecutionConcurrencyLimit,
} from '@/lib/execution/execution-concurrency-limit'
import {
  getLocalVmSaturationLimitMessage,
  isLocalVmSaturationLimitError,
} from '@/lib/execution/local-saturation-limit'
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
  workflowId?: string
  workspaceId?: string
  concurrencyLeaseInherited?: boolean
  deferOnQueueSaturation?: boolean
  isCustomTool?: boolean
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

export function isFunctionExecutionPayload(
  value: unknown,
): value is FunctionExecutionPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.userId === 'string' && typeof candidate.code === 'string'
  )
}

function calculateFunctionExecutionCost(params: {
  executionTimeMs: number
  functionExecutionChargeUsd: number
  functionExecutionDurationMultiplier: number
}): number {
  const executionSeconds = Math.max(params.executionTimeMs, 0) / 1000
  const totalCost =
    Math.max(params.functionExecutionChargeUsd, 0) +
    executionSeconds * Math.max(params.functionExecutionDurationMultiplier, 0)

  return Number(totalCost.toFixed(6))
}

export async function executeFunctionRequest(
  payload: FunctionExecutionPayload,
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
    outputStdout = stdout,
  ): FunctionExecutionResponse => ({
    statusCode: 200,
    body: { success: true, output: buildOutput(result, executionTime, outputStdout) },
  })
  const respondFailure = (
    error: string,
    executionTime: number,
    status = 500,
    outputStdout = stdout,
    debug?: Record<string, unknown>,
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
      concurrencyLeaseInherited = false,
      deferOnQueueSaturation = false,
      isCustomTool = false,
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
        402,
      )
    }

    const executionParams = { ...params }
    executionParams._context = undefined

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
      workflowVariables,
    )
    resolvedCode = nextResolvedCode

    const disallowedPineUsageReason = await findFunctionPineDisallowedReason(resolvedCode)
    if (disallowedPineUsageReason) {
      return respondFailure(disallowedPineUsageReason, Date.now() - startTime, 400)
    }

    const transpiledCode = await transpileTypeScriptCode(resolvedCode)
    const runtimeExecution = await withExecutionConcurrencyLimit({
      concurrencyLeaseInherited,
      userId: payload.userId,
      workspaceId,
      workflowId,
      task: () =>
        executeFunctionWithRuntimeGate({
          requestId,
          transpiledCode,
          resolvedCode,
          timeout,
          isCustomTool,
          e2bUserScope,
          executionParams,
          envVars,
          contextVariables,
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
        }),
    })

    const runtimeStdout = runtimeExecution.stdout || stdout
    stdout = runtimeStdout
    userCodeStartLine = runtimeExecution.userCodeStartLine
    let functionExecutionCost = 0

    if (await isBillingEnabledForRuntime()) {
      try {
        const billingContext = workflowId
          ? await resolveWorkflowBillingContext({
              workflowId,
              actorUserId: payload.userId,
            })
          : await resolveWorkspaceBillingContext({
              workspaceId,
              actorUserId: payload.userId,
            })
        const billingSettings = await getResolvedBillingSettings()
        functionExecutionCost = calculateFunctionExecutionCost({
          executionTimeMs: runtimeExecution.executionTime,
          functionExecutionChargeUsd: billingSettings.functionExecutionChargeUsd,
          functionExecutionDurationMultiplier: getTierFunctionExecutionDurationMultiplier(
            billingContext.tier,
          ),
        })
        if (functionExecutionCost > 0) {
          await accrueUserUsageCost({
            userId: payload.userId,
            workspaceId,
            workflowId,
            cost: functionExecutionCost,
            reason: 'function_execution',
          })
        }
      } catch (billingError) {
        logger.error(`[${requestId}] Failed to record function execution billing`, {
          error: billingError,
          userId: payload.userId,
          workflowId,
          workspaceId,
          executionTime: runtimeExecution.executionTime,
          runtimeSuccess: runtimeExecution.success,
        })
      }
    }

    if (!runtimeExecution.success) {
      logger.warn(`[${requestId}] Function execution failed after runtime attempt`, {
        engine: runtimeExecution.engine,
        executionTime: runtimeExecution.executionTime,
        functionExecutionCost,
        error: runtimeExecution.error,
      })

      if ('rawError' in runtimeExecution) {
        if (
          deferOnQueueSaturation &&
          isLocalVmSaturationLimitError(runtimeExecution.rawError)
        ) {
          throw runtimeExecution.rawError
        }

        const enhancedError = extractEnhancedError(
          runtimeExecution.rawError,
          userCodeStartLine,
          resolvedCode,
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
          },
        )
      }

      return respondFailure(
        runtimeExecution.error || 'Function execution failed',
        runtimeExecution.executionTime,
        500,
        runtimeStdout,
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
    if (isExecutionConcurrencyLimitError(error)) {
      if (payload.deferOnQueueSaturation) {
        throw error
      }

      return respondFailure(
        getExecutionConcurrencyLimitMessage(error),
        Date.now() - startTime,
        error.statusCode,
      )
    }

    if (isExecutionConcurrencyBackendUnavailableError(error)) {
      if (payload.deferOnQueueSaturation) {
        throw error
      }

      return respondFailure(error.message, Date.now() - startTime, error.statusCode)
    }

    if (isLocalVmSaturationLimitError(error)) {
      if (payload.deferOnQueueSaturation) {
        throw error
      }

      return respondFailure(
        getLocalVmSaturationLimitMessage(error),
        Date.now() - startTime,
        error.statusCode,
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
