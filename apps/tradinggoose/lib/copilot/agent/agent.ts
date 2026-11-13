import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import type { Memory } from '@mastra/memory'
import type { z } from 'zod'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import type { JsonObject } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { authorizeNativeConversationScope } from '@/lib/copilot/native/target'
import { ToolArgSchemas, ToolIds, ToolResultSchemas } from '@/lib/copilot/registry'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { isWorkspaceAgnosticServerTool, routeExecution } from '@/lib/copilot/tools/server/router'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import {
  type CopilotExecution,
  CopilotSuspendSchema,
  getCopilotExecution,
  resolveCopilotRunToolContext,
} from './context'
import { COPILOT_INSTRUCTIONS } from './instructions'
import { assertCopilotRunActive, runCopilotEffectOnce } from './state'

function createCopilotTools(execution: CopilotExecution) {
  return Object.fromEntries(
    ToolIds.options.map((name) => [
      name,
      createTool({
        id: name,
        strict: false,
        description: TOOL_PROMPT_METADATA[name].description,
        inputSchema: ToolArgSchemas[name] as z.ZodType<JsonObject>,
        // Only the server can produce resume data. Business schemas validate the final result.
        suspendSchema: CopilotSuspendSchema,
        requireApproval: shouldRequireToolApproval(
          execution.run.accessLevel,
          getCopilotToolPolicy(name).gated
        ),
        execute: async (args, context) => {
          const live = getCopilotExecution(context.requestContext)
          if (!live || !context.agent)
            throw new NativeTargetError('An active Studio invocation is required', 403)
          let settled!: () => void
          const pendingTool = new Promise<void>((resolve) => {
            settled = resolve
          })
          live.pendingTools.add(pendingTool)
          try {
            const { run, signal } = live
            signal.throwIfAborted()
            await authorizeNativeConversationScope(run.scope.actorUserId, run.scope.workspaceId)
            await assertCopilotRunActive(run.runId)
            await live.assertOwnership()
            const identity = nativeConversationIdentity(run.scope)
            if (
              context.agent.threadId !== run.threadId ||
              context.agent.resourceId !== identity.resourceId
            )
              throw new NativeTargetError('Copilot tool scope has changed', 403)
            const resumed =
              live.pending?.target.runId === run.runId &&
              live.pending.target.threadId === run.threadId &&
              live.pending.target.toolCallId === context.agent.toolCallId &&
              live.pending.target.toolName === name
            if (
              resumed &&
              stableStringifyJsonValue(live.pending!.originalArgs) !==
                stableStringifyJsonValue(args)
            )
              throw new NativeTargetError('Suspended Copilot tool arguments have changed', 403)
            const pending = {
              target: {
                threadId: run.threadId,
                resourceId: identity.resourceId,
                runId: run.runId,
                toolCallId: context.agent.toolCallId,
                toolName: name,
              },
              stage: 'result' as const,
              originalArgs: args,
              context: isWorkspaceAgnosticServerTool(name)
                ? run.scope.workspaceId
                  ? { workspaceId: run.scope.workspaceId }
                  : undefined
                : resolveCopilotRunToolContext(run, name, args),
              ...(resumed && live.pending?.preview ? { preview: live.pending.preview } : {}),
            }
            const businessContext: ServerToolExecutionContext = {
              ...pending.context,
              userId: run.scope.actorUserId,
              accessLevel: run.accessLevel,
              signal,
            }
            await authorizeNativeBusinessResult(run.scope, pending, undefined, businessContext)
            let result: unknown
            if (resumed && live.decision?.action === 'result') {
              result = live.decision.result
            } else if (pending.preview) {
              const decision = live.decision
              const baseStateHash = live.pending?.reviewBaseStateHash
              if (
                !decision ||
                !['review.accept', 'review.reject'].includes(decision.action) ||
                !baseStateHash
              )
                throw new NativeTargetError('A decision on the current preview is required', 409)
              result = await runCopilotEffectOnce(
                run,
                context.agent.toolCallId,
                'review',
                async () =>
                  decision.action === 'review.accept'
                    ? routeExecution(name, args, {
                        ...businessContext,
                        accessLevel: 'full',
                        acceptedReviewBaseStateHash: baseStateHash,
                      })
                    : { success: false, rejected: true, toolName: name }
              )
            } else if (getCopilotToolPolicy(name).execution === 'server') {
              result = await runCopilotEffectOnce(run, context.agent.toolCallId, 'execute', () =>
                routeExecution(name, args, businessContext)
              )
            } else {
              await context.agent.suspend({ originalArgs: args })
              return
            }
            if (
              result &&
              typeof result === 'object' &&
              'requiresReview' in result &&
              result.requiresReview === true
            ) {
              const { reviewBaseStateHash, ...preview } = result as JsonObject
              if (typeof reviewBaseStateHash !== 'string' || !reviewBaseStateHash)
                throw new NativeTargetError('Tool preview is missing its current base state', 409)
              await context.agent.suspend({ originalArgs: args, preview, reviewBaseStateHash })
              return
            }
            const typed = ToolResultSchemas[name].parse(result)
            await authorizeNativeBusinessResult(run.scope, pending, typed, businessContext)
            signal.throwIfAborted()
            return typed
          } finally {
            settled()
            live.pendingTools.delete(pendingTool)
          }
        },
      }),
    ])
  )
}

export function createCopilotAgent(memory: Memory) {
  return new Agent({
    id: 'studio-copilot',
    name: 'Studio Copilot',
    memory,
    instructions: ({ requestContext }) => {
      const execution = getCopilotExecution(requestContext)
      if (!execution) throw new Error('An active Studio invocation is required')
      return `${COPILOT_INSTRUCTIONS}

Authorized conversation scope: ${JSON.stringify({ workspaceId: execution.run.scope.workspaceId })}
Use authorized workspace IDs from the request context or tool results for workspace-scoped tools. A null conversation workspaceId means personal billing; ask the user to select a workspace only when no authorized business workspace is available. Never invent workspace IDs.`
    },
    model: ({ requestContext }) => {
      const execution = getCopilotExecution(requestContext)
      if (!execution) throw new Error('A server-selected Copilot model is required')
      return execution.model
    },
    tools: ({ requestContext }) => {
      const execution = getCopilotExecution(requestContext)
      return execution ? createCopilotTools(execution) : {}
    },
  })
}
