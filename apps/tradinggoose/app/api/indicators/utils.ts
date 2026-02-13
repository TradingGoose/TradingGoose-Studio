import { type NextRequest, NextResponse } from 'next/server'
import type { ZodTypeAny, z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { resolveIndicatorRuntimeConfig } from '@/lib/indicators/runtime-config'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

export { resolveIndicatorRuntimeConfig }

type IndicatorErrorResponseShape = 'withSuccess' | 'errorOnly'

const createIndicatorErrorResponse = (
  message: string,
  status: number,
  shape: IndicatorErrorResponseShape
) => {
  if (shape === 'errorOnly') {
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ success: false, error: message }, { status })
}

export const checkWorkspacePermission = async ({
  userId,
  workspaceId,
  requireWrite = false,
  responseShape = 'withSuccess',
}: {
  userId: string
  workspaceId: string
  requireWrite?: boolean
  responseShape?: IndicatorErrorResponseShape
}): Promise<
  | { ok: true; permission: string }
  | { ok: false; code: 'access_denied' | 'write_permission_required'; response: NextResponse }
> => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    return {
      ok: false,
      code: 'access_denied',
      response: createIndicatorErrorResponse('Access denied', 403, responseShape),
    }
  }

  if (requireWrite && permission !== 'admin' && permission !== 'write') {
    return {
      ok: false,
      code: 'write_permission_required',
      response: createIndicatorErrorResponse('Write permission required', 403, responseShape),
    }
  }

  return { ok: true, permission }
}

export const getWorkspaceWritePermissionError = async (
  userId: string,
  workspaceId: string,
  {
    responseShape = 'withSuccess',
  }: {
    responseShape?: IndicatorErrorResponseShape
  } = {}
) => {
  const result = await checkWorkspacePermission({
    userId,
    workspaceId,
    requireWrite: true,
    responseShape,
  })
  return result.ok ? null : result.response
}

type IndicatorLogger = {
  warn: (message: string, ...args: unknown[]) => void
}

export const authenticateIndicatorRequest = async ({
  request,
  requestId,
  logger,
  action,
  responseShape = 'withSuccess',
}: {
  request: NextRequest
  requestId: string
  logger: IndicatorLogger
  action: string
  responseShape?: IndicatorErrorResponseShape
}): Promise<{ userId: string; authType: string | undefined } | { response: NextResponse }> => {
  const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized indicator ${action} attempt`)
    return { response: createIndicatorErrorResponse('Unauthorized', 401, responseShape) }
  }

  return { userId: authResult.userId, authType: authResult.authType }
}

export const parseIndicatorRequestBody = async <Schema extends ZodTypeAny>({
  request,
  schema,
  responseShape = 'withSuccess',
}: {
  request: NextRequest
  schema: Schema
  responseShape?: IndicatorErrorResponseShape
}): Promise<{ data: z.infer<Schema> } | { response: NextResponse }> => {
  const body = await request.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.errors[0]?.message ?? 'Invalid request'
    return { response: createIndicatorErrorResponse(message, 400, responseShape) }
  }

  return { data: parsed.data }
}

export const isExecutionTimeoutError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('timed out')
}
