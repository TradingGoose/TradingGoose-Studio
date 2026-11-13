import { z } from 'zod'
import { readCopilotRun } from '@/lib/copilot/agent/context'
import { assertCopilotRunActive, claimCopilotBrowserEffect } from '@/lib/copilot/agent/state'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import { resolveWorkflowRunTrigger } from '@/lib/workflows/triggers'
import { authorizeNativeBusinessResult } from './business-access'
import { TargetSchema } from './contract'
import { NativeTargetError } from './errors'
import { authorizeNativeConversationScope, resolveNativePendingTarget } from './target'

const nativeTargetSchema = z
  .object({ workspaceId: z.string().min(1).nullable(), target: TargetSchema })
  .strict()

/** Native context is mandatory in the managed Copilot caller; ordinary authenticated manual APIs retain their own gates. */
export async function authorizeNativeWorkflowQueueEffect(
  actorUserId: string,
  workflowId: string,
  body: {
    native?: unknown
    executionId?: string
    input?: unknown
    executionTarget?: unknown
    triggerType?: unknown
    workflowData?: WorkflowExecutionBlueprint['workflowData']
    triggerBlockId?: string
  },
  signal?: AbortSignal
) {
  if (body.native === undefined) return
  const native = nativeTargetSchema.parse(body.native)
  const scope = await authorizeNativeConversationScope(actorUserId, native.workspaceId)
  const pending = await resolveNativePendingTarget(scope, native.target, 'result', signal)
  if (pending.target.toolName !== 'run_workflow')
    throw new NativeTargetError('Native target is not a workflow execution', 422)
  const args = ToolArgSchemas.run_workflow.parse(pending.originalArgs)
  if (
    args.entityId !== workflowId ||
    body.executionId !== pending.target.toolCallId ||
    body.executionTarget !== 'live' ||
    args.triggerBlockId !== body.triggerBlockId ||
    !body.workflowData
  ) {
    throw new NativeTargetError(
      'Workflow request does not match the original native execution',
      403
    )
  }
  const workflowInput =
    typeof args.workflow_input === 'string' ? { input: args.workflow_input } : args.workflow_input
  const expected = resolveWorkflowRunTrigger(body.workflowData.blocks, body.workflowData.edges, {
    surface: 'copilot',
    workflowInput,
    triggerBlockId: args.triggerBlockId,
  })
  if (
    expected.triggerType !== body.triggerType ||
    stableStringifyJsonValue(expected.input) !== stableStringifyJsonValue(body.input ?? {})
  ) {
    throw new NativeTargetError(
      'Workflow trigger/input differs from the original native request',
      403
    )
  }
  await authorizeNativeBusinessResult(scope, pending)
  signal?.throwIfAborted()
  await assertCopilotRunActive(pending.target.runId)
  const run = await readCopilotRun(scope, pending.target.threadId, pending.target.runId)
  await resolveCopilotModel(run.model)
  await claimCopilotBrowserEffect(run, pending.target.toolCallId)
}

export async function authorizeNativeWorkflowDeploymentEffect(
  actorUserId: string,
  workflowId: string,
  nativeContext: unknown,
  action: 'deploy' | 'undeploy',
  signal?: AbortSignal
) {
  if (nativeContext === undefined) return
  const native = nativeTargetSchema.parse(nativeContext)
  const scope = await authorizeNativeConversationScope(actorUserId, native.workspaceId)
  const pending = await resolveNativePendingTarget(scope, native.target, 'result', signal)
  if (pending.target.toolName !== 'deploy_workflow')
    throw new NativeTargetError('Native target is not a workflow deployment', 422)
  const args = ToolArgSchemas.deploy_workflow.parse(pending.originalArgs)
  if (
    args.entityId !== workflowId ||
    args.action !== action ||
    (action === 'deploy' && args.deployType !== 'api')
  ) {
    throw new NativeTargetError('Deployment differs from the original native request', 403)
  }
  await authorizeNativeBusinessResult(scope, pending)
  signal?.throwIfAborted()
  await assertCopilotRunActive(pending.target.runId)
  const run = await readCopilotRun(scope, pending.target.threadId, pending.target.runId)
  await resolveCopilotModel(run.model)
  await claimCopilotBrowserEffect(run, pending.target.toolCallId)
}
