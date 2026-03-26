import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { deleteSkill, listSkills, upsertSkills } from '@/lib/skills/operations'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('SkillsAPI')

const SkillSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  skills: z.array(
    z.object({
      id: z.string().optional(),
      name: z
        .string()
        .min(1, 'Skill name is required')
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case (e.g. my-skill)'),
      description: z.string().min(1, 'Description is required').max(1024),
      content: z.string().min(1, 'Content is required').max(50000, 'Content is too large'),
    })
  ),
})

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const result = await listSkills({ workspaceId })
    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching skills:`, error)
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    try {
      const { skills, workspaceId } = SkillSchema.parse(body)

      const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      if (permission !== 'admin' && permission !== 'write') {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      const resultSkills = await upsertSkills({
        skills,
        workspaceId,
        userId: authResult.userId,
        requestId,
      })

      return NextResponse.json({ success: true, data: resultSkills })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid skills data`, { errors: validationError.errors })
        const workspaceError = validationError.errors.find(
          (error) => error.path.length === 1 && error.path[0] === 'workspaceId'
        )
        if (workspaceError) {
          return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
        }

        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }

      if (validationError instanceof Error && validationError.message.includes('already exists')) {
        return NextResponse.json({ error: validationError.message }, { status: 409 })
      }

      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating skills`, error)
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const skillId = searchParams.get('id')
  const workspaceId = searchParams.get('workspaceId')

  if (!skillId) {
    logger.warn(`[${requestId}] Missing skill ID for deletion`)
    return NextResponse.json({ error: 'Skill ID is required' }, { status: 400 })
  }

  if (!workspaceId) {
    logger.warn(`[${requestId}] Missing workspaceId for deletion`)
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skill deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const deleted = await deleteSkill({ skillId, workspaceId })
    if (!deleted) {
      logger.warn(`[${requestId}] Skill not found: ${skillId}`)
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
}
