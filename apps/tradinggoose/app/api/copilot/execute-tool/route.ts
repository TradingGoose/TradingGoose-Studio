import { db } from '@tradinggoose/db'
import { account } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'
import { getTool, getToolAsync } from '@/tools/utils'

const logger = createLogger('CopilotExecuteToolAPI')

const ExecuteToolSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.any()).optional().default({}),
  workflowId: z.string().optional(),
})

function resolveEnvVarReferences(value: any, envVars: Record<string, string>): any {
  if (typeof value === 'string') {
    const exactMatchPattern = /^\{\{([^}]+)\}\}$/
    const exactMatch = exactMatchPattern.exec(value)
    if (exactMatch) {
      const envVarName = exactMatch[1].trim()
      return envVars[envVarName] ?? value
    }

    return value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedName = String(varName).trim()
      return envVars[trimmedName] ?? match
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVarReferences(item, envVars))
  }

  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveEnvVarReferences(val, envVars)
    }
    return resolved
  }

  return value
}

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const userId = session.user.id
    const body = await req.json()

    try {
      const preview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming execute-tool request`, { preview })
    } catch { }

    const { toolCallId, toolName, arguments: toolArgs, workflowId } = ExecuteToolSchema.parse(body)

    let workspaceId: string | undefined
    if (workflowId) {
      const { hasAccess, workspaceId: resolvedWorkspaceId } = await verifyWorkflowAccess(
        userId,
        workflowId
      )
      if (!hasAccess) {
        const message = createPermissionError('run tools in')
        return NextResponse.json({ error: message }, { status: 403 })
      }
      workspaceId = resolvedWorkspaceId
    }

    const toolConfig = toolName.startsWith('custom_')
      ? await getToolAsync(toolName, workflowId, workspaceId)
      : getTool(toolName)
    const isMcpTool = toolName.startsWith('mcp-')

    if (!toolConfig && !isMcpTool) {
      let similarTools: string[] = []
      try {
        const { tools: allTools } = await import('@/tools/registry')
        const allToolNames = Object.keys(allTools)
        const prefix = toolName.split('_')[0]
        similarTools = allToolNames.filter((name) => name.startsWith(`${prefix}_`)).slice(0, 10)
      } catch { }

      return NextResponse.json(
        {
          success: false,
          error: `Tool not found: ${toolName}${similarTools.length ? `. Similar tools: ${similarTools.join(', ')}` : ''
            }`,
          toolCallId,
        },
        { status: 404 }
      )
    }

    const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
    const executionParams: Record<string, any> = resolveEnvVarReferences(toolArgs, decryptedEnvVars)

    if (toolConfig?.oauth?.required && toolConfig.oauth.provider) {
      const provider = toolConfig.oauth.provider
      if (!executionParams.accessToken) {
        let credential = null
        if (executionParams.credential) {
          const credentials = await db
            .select()
            .from(account)
            .where(and(eq(account.id, executionParams.credential), eq(account.userId, userId)))
            .limit(1)
          credential = credentials[0] || null
        }

        if (!credential) {
          const credentials = await db
            .select()
            .from(account)
            .where(and(eq(account.providerId, provider), eq(account.userId, userId)))
            .orderBy(desc(account.updatedAt))
            .limit(1)
          credential = credentials[0] || null
        }

        if (!credential) {
          return NextResponse.json(
            {
              success: false,
              error: `No ${provider} account connected. Please connect your account first.`,
              toolCallId,
            },
            { status: 400 }
          )
        }

        const requestId = generateRequestId()
        const { accessToken } = await refreshTokenIfNeeded(requestId, credential as any, credential.id)

        if (!accessToken) {
          return NextResponse.json(
            {
              success: false,
              error: `OAuth token not available for ${provider}. Please reconnect your account.`,
              toolCallId,
            },
            { status: 400 }
          )
        }

        executionParams.accessToken = accessToken
        if (executionParams.credential) {
          delete executionParams.credential
        }
      }
    }

    const needsApiKey = toolConfig?.params?.apiKey?.required
    if (needsApiKey && !executionParams.apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
          toolCallId,
        },
        { status: 400 }
      )
    }

    executionParams._context = {
      workflowId,
      workspaceId,
      userId,
    }

    if (toolName === 'function_execute') {
      executionParams.envVars = decryptedEnvVars
      executionParams.workflowVariables = executionParams.workflowVariables || {}
      executionParams.blockData = executionParams.blockData || {}
      executionParams.blockNameMapping = executionParams.blockNameMapping || {}
      executionParams.language = executionParams.language || DEFAULT_CODE_LANGUAGE
      executionParams.timeout = executionParams.timeout || DEFAULT_EXECUTION_TIMEOUT_MS
    }

    const result = await executeTool(toolName, executionParams)

    return NextResponse.json({
      success: true,
      toolCallId,
      result: {
        success: result.success,
        output: result.output,
        error: result.error,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug(`[${tracker.requestId}] Zod validation error`, { issues: error.issues })
      return createBadRequestResponse('Invalid request body for execute-tool')
    }
    logger.error(`[${tracker.requestId}] Failed to execute tool:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute tool'
    return createInternalServerErrorResponse(errorMessage)
  }
}
