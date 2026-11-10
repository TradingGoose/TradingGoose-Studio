import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import type { Memory } from '@mastra/memory'
import { z } from 'zod'
import { verifyFinancialAcceptance } from '@/lib/billing/native-finance'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import type { JsonObject } from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import {
  authorizeNativeConversationScope,
  copyNativeFinancialSource,
  NativeTargetError,
  verifyCopilotPendingSource,
} from '@/lib/copilot/native/target'
import { ToolArgSchemas, ToolIds, ToolResultSchemas } from '@/lib/copilot/registry'
import { resolveCopilotToolContext } from '@/lib/copilot/tool-context'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import {
  hashServerToolReviewBase,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  acceptServerManagedToolReview,
  rejectServerManagedToolReview,
  stageServerManagedToolReview,
} from '@/lib/copilot/tools/server/review-acceptance'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { type CopilotExecution, getCopilotExecution } from './context'
import { COPILOT_INSTRUCTIONS } from './instructions'
import { assertCopilotRunActive, runCopilotEffectOnce, saveCopilotOccurrence } from './state'

function createCopilotTools(execution: CopilotExecution) {
  return Object.fromEntries(
    ToolIds.options.map((name) => [
      name,
      createTool({
        id: name,
        description: TOOL_PROMPT_METADATA[name].description,
        inputSchema: ToolArgSchemas[name] as z.ZodType<JsonObject>,
        // Only the server can produce resume data. Business schemas validate the final result.
        suspendSchema: z.object({
          originalArgs: z.record(z.string(), z.json()),
          preview: z.record(z.string(), z.json()).optional(),
          financialOccurrence: z.object({
            stepNumber: z.number().int().nonnegative(),
            retryCount: z.number().int().nonnegative(),
            runId: z.string().optional(),
          }),
        }),
        requireApproval: shouldRequireToolApproval(
          execution.run.accessLevel,
          getCopilotToolPolicy(name).gated
        ),
        execute: async (args, context) => {
          const live = getCopilotExecution(context.requestContext)
          if (!live || !context.agent)
            throw new NativeTargetError('An active Studio invocation is required', 403)
          const { run, finance, signal } = live
          signal.throwIfAborted()
          await authorizeNativeConversationScope(run.scope.actorUserId, run.scope.workspaceId)
          await assertCopilotRunActive(run.runId)
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
          const occurrence = resumed
            ? live.pending!.financialOccurrence
            : (finance.getLastOccurrence() ?? run.occurrence)
          if (!occurrence)
            throw new NativeTargetError('The tool has no accepted model occurrence', 403)
          await verifyFinancialAcceptance(run.binding, occurrence)
          await saveCopilotOccurrence(run, occurrence)
          if (
            resumed &&
            stableStringifyJsonValue(live.pending!.originalArgs) !== stableStringifyJsonValue(args)
          )
            throw new NativeTargetError('Suspended Copilot tool arguments have changed', 403)
          const pending = await verifyCopilotPendingSource(
            run.scope,
            {
              target: {
                threadId: run.threadId,
                resourceId: identity.resourceId,
                runId: run.runId,
                toolCallId: context.agent.toolCallId,
                toolName: name,
              },
              stage: 'result',
              originalArgs: args,
              financialBinding: run.binding,
              financialOccurrence: occurrence,
              ...(resumed && live.pending?.preview ? { preview: live.pending.preview } : {}),
            },
            signal
          )
          const businessContext: ServerToolExecutionContext = {
            ...resolveCopilotToolContext(
              name,
              args,
              run.toolContext ??
                (run.scope.workspaceId ? { workspaceId: run.scope.workspaceId } : undefined),
              run.toolContexts
            ),
            userId: run.scope.actorUserId,
            accessLevel: run.accessLevel,
            signal,
            nativeReviewBinding: hashServerToolReviewBase({
              target: pending.target,
              scope: run.scope,
              originalArgs: args,
            }),
          }
          copyNativeFinancialSource(pending, businessContext)
          await authorizeNativeBusinessResult(run.scope, pending, undefined, businessContext)
          let result: unknown
          if (resumed && live.decision?.action === 'result') {
            result = live.decision.result
          } else if (pending.preview) {
            const decision = live.decision
            if (
              !decision ||
              !('reviewToken' in decision) ||
              decision.reviewToken !== pending.preview.reviewToken
            )
              throw new NativeTargetError('A decision on the current preview is required', 409)
            result = await runCopilotEffectOnce(
              run.runId,
              context.agent.toolCallId,
              'review',
              decision,
              () =>
                decision.action === 'review.accept'
                  ? acceptServerManagedToolReview(name, decision.reviewToken, businessContext)
                  : rejectServerManagedToolReview(name, decision.reviewToken, businessContext)
            )
          } else if (getCopilotToolPolicy(name).execution === 'server') {
            result = await runCopilotEffectOnce(
              run.runId,
              context.agent.toolCallId,
              'execute',
              { args, scope: run.scope },
              async () =>
                stageServerManagedToolReview(
                  name,
                  args,
                  await routeExecution(name, args, businessContext),
                  businessContext
                )
            )
          } else {
            await context.agent.suspend({ originalArgs: args, financialOccurrence: occurrence })
            return
          }
          if (
            result &&
            typeof result === 'object' &&
            'requiresReview' in result &&
            result.requiresReview === true
          ) {
            await context.agent.suspend({
              originalArgs: args,
              preview: result as JsonObject,
              financialOccurrence: occurrence,
            })
            return
          }
          const typed = ToolResultSchemas[name].parse(result)
          await authorizeNativeBusinessResult(run.scope, pending, typed, businessContext)
          signal.throwIfAborted()
          return typed
        },
      }),
    ])
  )
}

export function createCopilotAgent(memory: Memory) {
  return new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'studio-copilot',
    name: 'Studio Copilot',
    memory,
    instructions: COPILOT_INSTRUCTIONS,
    model: ({ requestContext }) => {
      const execution = getCopilotExecution(requestContext)
      if (!execution) throw new Error('A server-selected Copilot model is required')
      return createConfiguredLanguageModel(execution.run.model)
    },
    tools: ({ requestContext }) => {
      const execution = getCopilotExecution(requestContext)
      return execution ? createCopilotTools(execution) : {}
    },
  })
}
