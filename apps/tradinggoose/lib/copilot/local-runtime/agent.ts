import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveVllmServiceConfig } from '@/lib/system-services/runtime'
import { LOCAL_COPILOT_MODEL_PREFIX } from '@/lib/copilot/local-runtime/runtime-models'
import {
  DEFAULT_LOCAL_CONTEXT_WINDOW,
  buildLocalWorkingMessages,
  type LocalWorkingMessage,
} from '@/lib/copilot/local-runtime/working-messages'
import { getLocalCopilotSystemPrompt } from '@/lib/copilot/local-runtime/prompt'
import type { LocalAgentTurnParams } from '@/lib/copilot/local-runtime/types'

const logger = createLogger('LocalCopilotAgent')

/**
 * Tools whose implementation only exists in the browser. When the model calls
 * one of these the local loop halts and hands control back to the client, which
 * executes the tool and resumes via `/api/copilot/tools/mark-complete`.
 *
 * Must stay in sync with the `clientTool(...)` entries in
 * `stores/copilot/tool-registry.ts` — they are the only tools with no server
 * implementation, so offering them to the model is safe.
 */
export const LOCAL_CLIENT_ONLY_TOOLS = new Set([
  'run_workflow',
  'plan',
  'checkoff_todo',
  'mark_todo_in_progress',
  'gdrive_request_access',
  'oauth_request_access',
  'deploy_workflow',
  'sleep',
])

const MAX_TOOL_ITERATIONS = 20
/** Hard cap on assistant text before truncation, to bound the SSE payload. */
const MAX_ASSISTANT_TEXT_CHARS = 200_000

type OpenAiTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type ToolCallAccumulator = {
  id: string
  name: string
  arguments: string
  index: number
}

export interface LocalAgentRunResult {
  /** Assistant text produced across every iteration of the turn. */
  text: string
  /** Working messages to persist for the next turn to resume from. */
  workingMessages: LocalWorkingMessage[]
  /** Set when the loop stopped so the browser could execute a client-only tool. */
  awaiting: { toolCallId: string; toolName: string } | null
}

function stripModelPrefix(model: string): string {
  return model.startsWith(LOCAL_COPILOT_MODEL_PREFIX)
    ? model.slice(LOCAL_COPILOT_MODEL_PREFIX.length)
    : model
}

function buildOpenAiTools(
  manifestTools: Array<{ name: string; description?: string; parameters?: unknown }>
): OpenAiTool[] {
  return manifestTools
    .filter((tool) => tool?.name && !LOCAL_CLIENT_ONLY_TOOLS.has(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters:
          tool.parameters && typeof tool.parameters === 'object'
            ? (tool.parameters as Record<string, unknown>)
            : { type: 'object', properties: {} },
      },
    }))
}

async function createLocalClient() {
  const vllmConfig = await resolveVllmServiceConfig()
  const baseUrl = (vllmConfig.baseUrl || '').replace(/\/$/, '')
  if (!baseUrl) {
    throw new Error('vLLM service is not configured (missing baseUrl)')
  }
  return new OpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey: vllmConfig.apiKey || 'empty',
    timeout: 10 * 60 * 1000,
  })
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value
}

function formatContextBlock(file: { filename?: string; mediaType?: string; content?: string }) {
  return `<attached_file name="${file.filename ?? 'attachment'}" media_type="${file.mediaType ?? 'text/plain'}">\n${file.content}\n</attached_file>`
}

/** Builds the user message for this turn, folding in any processed contexts. */
function buildUserContent(params: LocalAgentTurnParams, forModel: boolean): string {
  const parts = (params.contexts ?? [])
    .filter((context) => context?.content)
    .map(
      (context) =>
        `<context type="${context.type}" tag="${context.tag || context.type}">\n${context.content}\n</context>`
    )
  for (const file of params.fileContents ?? []) {
    if (file?.content) parts.push(formatContextBlock(file))
  }
  const userContent = parts.length
    ? `${parts.join('\n\n')}\n\n${params.userMessage}`
    : params.userMessage
  return forModel ? truncate(userContent, MAX_ASSISTANT_TEXT_CHARS) : userContent
}

/**
 * Runs the local Copilot agent loop against the self-hosted vLLM model.
 *
 * On the first iteration of a turn the loop starts from the caller-supplied
 * history and streams text deltas into `sink`; every server tool call is
 * executed in-process. When the model calls a client-only tool (or finishes
 * with plain text) the run returns the working messages so the caller can
 * persist them for the next turn.
 *
 * `onAssistantText` / `onToolItem` expose incremental state to the caller for
 * persistence without buffering the whole turn.
 */
export async function runLocalCopilotTurn(
  params: LocalAgentTurnParams,
  hooks: {
    /** Called once per iteration with the tool_calls message before execution. */
    onAssistantToolCalls?: (message: LocalWorkingMessage) => void | Promise<void>
    /** Called with each tool result message, for durable persistence. */
    onToolResult?: (message: LocalWorkingMessage) => void | Promise<void>
  } = {}
): Promise<LocalAgentRunResult> {
  const { sink, ctx } = params
  const modelId = stripModelPrefix(params.model)
  const client = await createLocalClient()

  const { getCopilotRuntimeToolManifest } = await import('@/lib/copilot/runtime-tool-manifest')
  const manifest = await getCopilotRuntimeToolManifest()
  const openAiTools = buildOpenAiTools(manifest.tools)

  const systemPrompt = getLocalCopilotSystemPrompt()
  const workingMessages: LocalWorkingMessage[] = buildLocalWorkingMessages({
    systemPrompt,
    priorWorkingMessages: params.priorWorkingMessages ?? [],
    userContent: buildUserContent(params, false),
    continuation: params.continuation,
    defaultContextWindow: DEFAULT_LOCAL_CONTEXT_WINDOW,
  })

  let fullText = ''

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.signal?.aborted) {
      throw new Error('Request aborted')
    }

    const stream = await client.chat.completions.create(
      {
        model: modelId,
        // buildLocalWorkingMessages already trimmed this list and prepended the
        // system prompt; re-trimming here would prepend a second copy.
        messages: workingMessages as never,
        tools: openAiTools as never,
        stream: true,
      },
      { signal: ctx.signal }
    )

    let textBuffer = ''
    const toolCalls = new Map<number, ToolCallAccumulator>()

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if (delta.content) {
        textBuffer += delta.content
        fullText += delta.content
        sink.send({
          event: 'response.output_text.delta',
          data: { item_id: 'local_assistant_text', delta: delta.content },
        })
      }

      if (delta.tool_calls) {
        for (const call of delta.tool_calls) {
          const index = call.index ?? 0
          const existing = toolCalls.get(index) ?? { id: '', name: '', arguments: '', index }
          if (call.id) existing.id = call.id
          if (call.function?.name) existing.name = call.function.name
          if (call.function?.arguments) existing.arguments += call.function.arguments
          toolCalls.set(index, existing)
        }
      }
    }

    const orderedCalls = [...toolCalls.values()]
      .sort((a, b) => a.index - b.index)
      .filter((call) => call.name)

    // No tool calls -> the turn is complete.
    if (orderedCalls.length === 0) {
      if (textBuffer.trim()) {
        workingMessages.push({ role: 'assistant', content: textBuffer })
      }
      return { text: fullText, workingMessages, awaiting: null }
    }

    const toolCallsMessage: LocalWorkingMessage = {
      role: 'assistant',
      content: textBuffer || null,
      tool_calls: orderedCalls.map((call, position) => ({
        id: call.id || `call_${call.index}_${position}`,
        type: 'function',
        function: { name: call.name, arguments: call.arguments || '{}' },
      })),
    }
    workingMessages.push(toolCallsMessage)
    await hooks.onAssistantToolCalls?.(toolCallsMessage)

    // Client-only tool -> stop and let the browser run it.
    const clientOnly = orderedCalls.find((call) => LOCAL_CLIENT_ONLY_TOOLS.has(call.name))
    if (clientOnly) {
      return {
        text: fullText,
        workingMessages,
        awaiting: {
          toolCallId: clientOnly.id || `call_${clientOnly.index}`,
          toolName: clientOnly.name,
        },
      }
    }

    for (const call of orderedCalls) {
      const toolCallId = call.id || `call_${call.index}`

      sink.send({
        event: 'response.output_item.done',
        data: {
          item: {
            type: 'function_call',
            id: toolCallId,
            call_id: toolCallId,
            name: call.name,
            arguments: call.arguments || '{}',
          },
        },
      })

      let payload: unknown = {}
      try {
        payload = call.arguments ? JSON.parse(call.arguments) : {}
      } catch {
        payload = {}
      }

      const {
        executeLocalCopilotServerTool,
      } = await import('@/lib/copilot/local-runtime/tool-execution')

      const result = await executeLocalCopilotServerTool({
        toolName: call.name,
        payload,
        context: {
          userId: ctx.userId,
          accessLevel: ctx.accessLevel,
          ...(ctx.contextEntityKind ? { contextEntityKind: ctx.contextEntityKind } : {}),
          ...(ctx.contextEntityId ? { contextEntityId: ctx.contextEntityId } : {}),
          ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
          signal: ctx.signal,
        },
      })

      logger.info('Local copilot tool executed', {
        conversationId: params.conversationId,
        toolName: call.name,
        success: result.success,
        stagedForReview: !!result.review,
      })

      if (result.success) {
        sink.send({
          event: 'tool_result',
          data: {
            toolCallId,
            success: true,
            result: result.result ?? null,
          },
        })
      } else {
        sink.send({
          event: 'tool_error',
          data: {
            toolCallId,
            success: false,
            error: result.errorMessage ?? 'Tool execution failed',
          },
        })
      }

      const toolMessage: LocalWorkingMessage = {
        role: 'tool',
        tool_call_id: toolCallId,
        content: buildToolResultContent(result),
      }
      workingMessages.push(toolMessage)
      await hooks.onToolResult?.(toolMessage)
    }
  }

  logger.warn('Local copilot agent hit max tool iterations', {
    conversationId: params.conversationId,
    model: modelId,
  })
  return { text: fullText, workingMessages, awaiting: null }
}

/** Serializes a tool result into the compact JSON the model sees. */
function buildToolResultContent(result: {
  success: boolean
  result?: unknown
  errorMessage?: string
  errorStatus?: number
  errorDetails?: unknown
  review?: unknown
}): string {
  if (!result.success) {
    return truncate(
      JSON.stringify({
        ok: false,
        error: result.errorMessage ?? 'Tool execution failed',
        ...(result.errorStatus ? { status: result.errorStatus } : {}),
        ...(result.errorDetails ? { details: result.errorDetails } : {}),
      }),
      20_000
    )
  }

  try {
    return truncate(JSON.stringify({ ok: true, result: result.result ?? null }), 200_000)
  } catch {
    return JSON.stringify({ ok: true, result: String(result.result) })
  }
}
