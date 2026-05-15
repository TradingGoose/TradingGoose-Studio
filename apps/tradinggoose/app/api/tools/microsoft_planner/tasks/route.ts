import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { validateMicrosoftGraphId } from '@/lib/security/input-validation'
import type { PlannerTask } from '@/tools/microsoft_planner/types'

const logger = createLogger('MicrosoftPlannerTasksAPI')

export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined
    const planId = searchParams.get('planId')
    const taskId = searchParams.get('taskId')

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId parameter`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    if (!planId && !taskId) {
      logger.error(`[${requestId}] Missing planId or taskId parameter`)
      return NextResponse.json({ error: 'Plan ID or Task ID is required' }, { status: 400 })
    }

    if (planId) {
      const planIdValidation = validateMicrosoftGraphId(planId, 'planId')
      if (!planIdValidation.isValid) {
        logger.error(`[${requestId}] Invalid planId: ${planIdValidation.error}`)
        return NextResponse.json({ error: planIdValidation.error }, { status: 400 })
      }
    }

    if (taskId) {
      const taskIdValidation = validateMicrosoftGraphId(taskId, 'taskId')
      if (!taskIdValidation.isValid) {
        logger.error(`[${requestId}] Invalid taskId: ${taskIdValidation.error}`)
        return NextResponse.json({ error: taskIdValidation.error }, { status: 400 })
      }
    }

    const credential = await resolveOAuthRouteCredential(
      request,
      { credentialId, workflowId, workspaceId },
      requestId
    )
    if (!credential.ok) return credential.response

    const response = await fetch(
      taskId
        ? `https://graph.microsoft.com/v1.0/planner/tasks/${taskId}`
        : `https://graph.microsoft.com/v1.0/planner/plans/${planId}/tasks`,
      {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorText)
      return NextResponse.json(
        { error: 'Failed to fetch tasks from Microsoft Graph' },
        { status: response.status }
      )
    }

    if (taskId) {
      const task = await response.json()
      return NextResponse.json({
        task: {
          id: task.id,
          title: task.title,
          planId: task.planId,
          bucketId: task.bucketId,
          percentComplete: task.percentComplete,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          createdDateTime: task.createdDateTime,
          completedDateTime: task.completedDateTime,
          hasDescription: task.hasDescription,
          assignments: task.assignments ? Object.keys(task.assignments) : [],
        },
      })
    }

    const data = await response.json()
    const tasks = data.value || []

    const filteredTasks = tasks.map((task: PlannerTask) => ({
      id: task.id,
      title: task.title,
      planId: task.planId,
      bucketId: task.bucketId,
      percentComplete: task.percentComplete,
      priority: task.priority,
      dueDateTime: task.dueDateTime,
      createdDateTime: task.createdDateTime,
      completedDateTime: task.completedDateTime,
      hasDescription: task.hasDescription,
      assignments: task.assignments ? Object.keys(task.assignments) : [],
    }))

    return NextResponse.json({
      tasks: filteredTasks,
      metadata: {
        planId,
        planUrl: `https://graph.microsoft.com/v1.0/planner/plans/${planId}`,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Planner tasks:`, error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}
