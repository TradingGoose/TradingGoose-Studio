import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AuthResult } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { WorkflowMemoryError } from '@/lib/mastra/memory-budget'

const logger = createLogger('MemoryAPI')
export const MemoryMessageSchema = z
  .object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })
  .strict()
export function requireMemoryAuth(auth: AuthResult) {
  if (!auth.success || !auth.userId) throw new WorkflowMemoryError('Unauthorized', 401)
}
export function memoryError(error: unknown) {
  const status =
    error instanceof WorkflowMemoryError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 500
  if (status === 500) logger.error('Memory request failed', { error })
  const message =
    error instanceof WorkflowMemoryError
      ? error.message
      : status === 400
        ? 'Invalid request data'
        : 'Memory request failed'
  return NextResponse.json(
    { success: false, error: { message } },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(status === 503 ? { 'Retry-After': '1' } : {}),
      },
    }
  )
}
