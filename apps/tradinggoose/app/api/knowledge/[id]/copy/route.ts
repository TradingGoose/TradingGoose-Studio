import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { copyKnowledgeBaseToWorkspace } from '@/lib/knowledge/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('KnowledgeBaseCopyAPI')

const CopyKnowledgeBaseSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base copy attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(id, session.user.id)
    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const validatedData = CopyKnowledgeBaseSchema.parse(await req.json())
    const copiedKnowledgeBase = await copyKnowledgeBaseToWorkspace(
      id,
      validatedData.workspaceId,
      session.user.id,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: copiedKnowledgeBase,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error copying knowledge base`, error)
    return NextResponse.json({ error: 'Failed to copy knowledge base' }, { status: 500 })
  }
}
