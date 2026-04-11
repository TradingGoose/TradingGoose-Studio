import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { getTierFunctionExecutionDurationMultiplier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import {
  getCodeExecutionConcurrencyLimitMessage,
  isCodeExecutionConcurrencyBackendUnavailableError,
  isCodeExecutionConcurrencyLimitError,
  withCodeExecutionConcurrencyLimit,
} from '@/lib/execution/concurrency-limit'
import {
  getLocalVmSaturationLimitMessage,
  isLocalVmSaturationLimitError,
} from '@/lib/execution/local-saturation-limit'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess, getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { resolveCodeVariables } from '../code-resolution'
import { executeFunctionWithRuntimeGate } from '../e2b-execution'
import { createUserFriendlyErrorMessage, extractEnhancedError } from '../error-formatting'
import { findFunctionPineDisallowedReason, transpileTypeScriptCode } from '../typescript-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 210

const logger = createLogger('FunctionExecuteAPI')

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
      workspaceId,
      isCustomTool = false,
    } = body
    const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return respondFailure('Unauthorized', Date.now() - startTime, 401)
    }
    const e2bUserScope = auth.userId

    if (workflowId) {
      const [workflowData] = await db
        .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowData) {
        return respondFailure('Workflow not found', Date.now() - startTime, 404)
      }

      let hasWorkflowAccess = workflowData.userId === auth.userId

      if (!hasWorkflowAccess && workflowData.workspaceId) {
        const workflowWorkspaceAccess = await checkWorkspaceAccess(
          workflowData.workspaceId,
          auth.userId
        )
        hasWorkflowAccess = workflowWorkspaceAccess.hasAccess
      }

      if (!hasWorkflowAccess) {
        return respondFailure('Workflow access denied', Date.now() - startTime, 403)
      }
    }

    if (workspaceId) {
      const workspacePermission = await getUserEntityPermissions(
        auth.userId,
        'workspace',
        workspaceId
      )

      if (!workspacePermission) {
        return respondFailure('Workspace access denied', Date.now() - startTime, 403)
      }
    }

    const usageCheck = await checkServerSideUsageLimits({
      userId: auth.userId,
      workspaceId,
      workflowId,
    })

    if (usageCheck.isExceeded) {
      logger.warn(`[${requestId}] Function execution blocked by usage limits`, {
        userId: auth.userId,
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
    const runtimeExecution = await withCodeExecutionConcurrencyLimit({
      userId: auth.userId,
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
    const billingContext = workflowId
      ? await resolveWorkflowBillingContext({
          workflowId,
          actorUserId: auth.userId,
        })
      : await resolveWorkspaceBillingContext({
          workspaceId,
          actorUserId: auth.userId,
        })
    const billingSettings = await getResolvedBillingSettings()
    const functionExecutionCost = calculateFunctionExecutionCost({
      executionTimeMs: runtimeExecution.executionTime,
      functionExecutionChargeUsd: billingSettings.functionExecutionChargeUsd,
      functionExecutionDurationMultiplier: getTierFunctionExecutionDurationMultiplier(
        billingContext.tier
      ),
    })
    if (functionExecutionCost > 0) {
      await accrueUserUsageCost({
        userId: auth.userId,
        workspaceId,
        workflowId,
        cost: functionExecutionCost,
        reason: 'function_execution',
      })
    }

    if (!runtimeExecution.success) {
      logger.warn(`[${requestId}] Function execution failed after runtime attempt`, {
        engine: runtimeExecution.engine,
        executionTime: runtimeExecution.executionTime,
        functionExecutionCost,
        error: runtimeExecution.error,
      })

      if ('rawError' in runtimeExecution) {
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
    if (isCodeExecutionConcurrencyBackendUnavailableError(error)) {
      return respondFailure(error.message, Date.now() - startTime, error.statusCode, stdout)
    }

    if (isCodeExecutionConcurrencyLimitError(error)) {
      return respondFailure(
        getCodeExecutionConcurrencyLimitMessage(error),
        Date.now() - startTime,
        error.statusCode
      )
    }

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
