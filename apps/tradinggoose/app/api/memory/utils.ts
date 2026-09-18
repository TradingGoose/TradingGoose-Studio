import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MemoryAPI')

export const MemoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
})

export function memoryError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { success: false, error: { message: 'Invalid request data' } },
      { status: 400 }
    )
  }
  logger.error('Memory request failed', { error })
  return NextResponse.json(
    { success: false, error: { message: 'Memory request failed' } },
    { status: 500 }
  )
}
