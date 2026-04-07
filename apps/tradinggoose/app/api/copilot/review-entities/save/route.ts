import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import {
  SaveReviewEntityError,
  saveReviewEntity,
  SaveReviewEntityRequestSchema,
} from '@/lib/copilot/review-sessions/save-entity'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ReviewEntitySaveAPI')

export async function POST(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = SaveReviewEntityRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = await saveReviewEntity(auth.userId, parsed.data)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof SaveReviewEntityError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error('Failed to save review entity', { error })
    return NextResponse.json({ error: 'Failed to save review entity' }, { status: 500 })
  }
}
