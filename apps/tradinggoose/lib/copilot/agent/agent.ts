import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import type { Memory } from '@mastra/memory'
import type { z } from 'zod'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import type { JsonObject } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { ToolArgSchemas, ToolIds } from '@/lib/copilot/registry'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import { type CopilotExecution, CopilotSuspendSchema, getCopilotExecution } from './context'
import { COPILOT_INSTRUCTIONS } from './instructions'

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
            await live.assertOwnership()
            const identity = nativeConversationIdentity(run.scope)
            if (
              context.agent.threadId !== run.threadId ||
              context.agent.resourceId !== identity.resourceId
            )
              throw new NativeTargetError('Copilot tool scope has changed', 403)
            const response = await live.executeTool(name, args, context.agent.toolCallId)
            if (response.suspend) {
              await context.agent.suspend(response.suspend)
              return
            }
            signal.throwIfAborted()
            return response.result
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
