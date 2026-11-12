import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import {
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { checkDeploymentStatusServerTool } from '@/lib/copilot/tools/server/workflow/check-deployment-status'
import {
  createWorkflowExecutionResultFromLog,
  readWorkflowExecutionAccessContext,
} from '@/lib/execution/workflow-execution-events'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { authorizeNativeBusinessResult, authorizeNativeCredential } from './business-access'
import type { Pending, Scope } from './contract'
import { NativeTargetError } from './target'

/** Reconstruct existing authorized postconditions. No execution, mutation or financial posting. */
export async function readbackNativeToolResult(
  scope: Scope,
  pending: Pending,
  context: ServerToolExecutionContext,
  reference?: { credentialId: string }
): Promise<unknown> {
  switch (pending.target.toolName) {
    case 'run_workflow': {
      if (reference)
        throw new NativeTargetError('Workflow readback does not accept a credential reference', 422)
      const args = ToolArgSchemas.run_workflow.parse(pending.originalArgs)
      const actorUserId = scope.actorUserId
      let originalWorkspaceId: string | undefined
      const assertOriginalLog = (originalLog: typeof workflowExecutionLogs.$inferSelect) => {
        const data = originalLog.executionData
        const environment =
          data && typeof data === 'object' && !Array.isArray(data) && 'environment' in data
            ? data.environment
            : undefined
        if (
          !originalLog ||
          originalLog.executionId !== pending.target.toolCallId ||
          originalLog.workflowId !== args.entityId ||
          originalLog.workspaceId !== originalWorkspaceId ||
          !environment ||
          typeof environment !== 'object' ||
          Array.isArray(environment) ||
          !('userId' in environment) ||
          environment.userId !== actorUserId
        ) {
          throw new NativeTargetError(
            'Original workflow execution log conflicts with its actor and workspace',
            403
          )
        }
      }
      const authorize = async (originalLog?: typeof workflowExecutionLogs.$inferSelect) => {
        throwIfServerToolAborted(context)
        await authorizeNativeBusinessResult(scope, pending, undefined, context)
        const access = await readWorkflowExecutionAccessContext({
          pendingExecutionId: pending.target.toolCallId,
          workflowId: args.entityId,
        })
        if (
          !access ||
          access.userId !== actorUserId ||
          !access.workspaceId?.trim() ||
          (originalWorkspaceId !== undefined && access.workspaceId !== originalWorkspaceId)
        ) {
          throw new NativeTargetError(
            'Original workflow execution does not belong to this actor and workspace',
            403
          )
        }
        if (!(await checkWorkspaceAccess(access.workspaceId, actorUserId)).hasAccess) {
          throw new NativeTargetError('Original execution workspace access has been revoked', 403)
        }
        originalWorkspaceId ??= access.workspaceId
        if (originalLog) assertOriginalLog(originalLog)
        throwIfServerToolAborted(context)
      }
      await authorize()
      const [row] = await db
        .select()
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, pending.target.toolCallId),
            eq(workflowExecutionLogs.workflowId, args.entityId)
          )
        )
        .limit(1)
      if (!row?.endedAt)
        throw new NativeTargetError('Original workflow execution has no terminal result', 409)
      assertOriginalLog(row)
      await authorize(row)
      const state = createWorkflowExecutionResultFromLog(row)
      if (state.status !== 'completed' && state.status !== 'failed')
        throw new NativeTargetError('Original workflow execution has no terminal result', 409)
      return {
        executionId: pending.target.toolCallId,
        message: state.failureReason ?? 'Workflow execution completed',
        data: state.result,
      }
    }
    case 'gdrive_request_access': {
      if (!reference)
        throw new NativeTargetError('A selected credential reference is required', 422)
      const credential = await authorizeNativeCredential(
        scope,
        reference.credentialId,
        context.workspaceId
      )
      return {
        granted: true,
        credentialId: credential.credentialId,
        workspaceId: credential.workspaceId,
      }
    }
    case 'deploy_workflow': {
      if (reference)
        throw new NativeTargetError(
          'Deployment readback does not accept a credential reference',
          422
        )
      const args = ToolArgSchemas.deploy_workflow.parse(pending.originalArgs)
      const state = await checkDeploymentStatusServerTool.execute(
        { entityId: args.entityId },
        context
      )
      const deployed = args.deployType === 'chat' ? state.chatDeployed : state.apiDeployed
      if (deployed !== (args.action === 'deploy'))
        throw new NativeTargetError('The requested deployment postcondition is not present', 409)
      return {
        action: args.action,
        deployType: args.deployType,
        isDeployed: state.isDeployed,
        ...(state.deployedAt ? { deployedAt: state.deployedAt } : {}),
      }
    }
    default:
      throw new NativeTargetError(
        'This tool has no authoritative readback; its effect must not be repeated to recover a result',
        409
      )
  }
}
