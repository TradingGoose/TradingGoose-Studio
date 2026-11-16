import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { resolveApiKeyForDeployment } from '@/lib/api-key/service'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { checkDeploymentStatusServerTool } from '@/lib/copilot/tools/server/workflow/check-deployment-status'
import { createWorkflowExecutionResultFromLog } from '@/lib/execution/workflow-execution-events'
import { authorizeNativeCredential, readAuthorizedWorkflowExecutionLog } from './business-access'
import type { Pending, Scope } from './contract'
import { NativeTargetError } from './errors'

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
      const row = await readAuthorizedWorkflowExecutionLog(scope, pending, context)
      const state = createWorkflowExecutionResultFromLog(row)
      return {
        executionId: row.executionId,
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
      if (args.action === 'deploy' && args.deployType === 'api') {
        const [row] = await db
          .select({ workspaceId: workflow.workspaceId, pinnedApiKeyId: workflow.pinnedApiKeyId })
          .from(workflow)
          .where(eq(workflow.id, args.entityId))
          .limit(1)
        if (!row) throw new NativeTargetError('Workflow not found', 404)
        if (
          !(await resolveApiKeyForDeployment(
            row.pinnedApiKeyId,
            scope.actorUserId,
            row.workspaceId
          ))
        )
          return {
            action: args.action,
            deployType: args.deployType,
            needsApiKey: true,
            message: 'Select a valid API key in the workflow deployment settings, then retry.',
          }
      }
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
