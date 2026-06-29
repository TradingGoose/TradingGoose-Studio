import { chat, db, workflow, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, desc, eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'

type CheckDeploymentStatusArgs = {
  entityId: string
}

type CheckDeploymentStatusResult = {
  isDeployed: boolean
  deploymentTypes: string[]
  apiDeployed: boolean
  chatDeployed: boolean
  deployedAt: string | null
}

export const checkDeploymentStatusServerTool: BaseServerTool<
  CheckDeploymentStatusArgs,
  CheckDeploymentStatusResult
> = {
  name: 'check_deployment_status',
  async execute(args, context) {
    const userId = context?.userId?.trim()
    if (!userId) {
      throw new Error('Authenticated user is required to check workflow deployment status')
    }

    const access = await verifyWorkflowAccess(userId, args.entityId, 'read')
    if (!access.hasAccess) {
      throw new Error('Access denied: You do not have permission to read this workflow')
    }

    const [workflowRow] = await db
      .select({
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
      })
      .from(workflow)
      .where(eq(workflow.id, args.entityId))
      .limit(1)

    if (!workflowRow) {
      throw new Error('Workflow not found')
    }

    const [activeDeployment] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, args.entityId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    const chatRows = activeDeployment
      ? await db
          .select({ id: chat.id })
          .from(chat)
          .where(
            and(
              eq(chat.workflowId, args.entityId),
              eq(chat.deploymentVersionId, activeDeployment.id),
              eq(chat.isActive, true)
            )
          )
          .limit(1)
      : []

    const apiDeployed = workflowRow.isDeployed || false
    const chatDeployed = chatRows.length > 0
    const deploymentTypes = [
      ...(apiDeployed ? ['api'] : []),
      ...(chatDeployed ? ['chat'] : []),
    ]

    return {
      isDeployed: apiDeployed || chatDeployed,
      deploymentTypes,
      apiDeployed,
      chatDeployed,
      deployedAt: workflowRow.deployedAt?.toISOString?.() ?? null,
    }
  },
}
