import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { encryptSecret } from '@/lib/utils-server'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowChatPasswordAPI')

const passwordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const body = await request.json()
    const { password } = passwordSchema.parse(body)
    const { encrypted } = await encryptSecret(password)

    return createSuccessResponse({
      encryptedPassword: encrypted,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error encrypting workflow chat password: ${id}`, error)
    if (error instanceof z.ZodError) {
      return createErrorResponse(error.errors[0]?.message || 'Invalid password', 400)
    }
    return createErrorResponse(error.message || 'Failed to encrypt chat password', 500)
  }
}
