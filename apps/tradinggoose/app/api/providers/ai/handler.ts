import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import type { MessageInput } from '@mastra/core/agent/message-list'
import { toStandardSchema } from '@mastra/core/schema'
import { NextResponse } from 'next/server'
import { projectNativeModelEvent } from '@/lib/mastra/events'
import { normalizeNativeMediaMessages } from '@/lib/mastra/media'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import {
  createAgentToolSet,
  createForcedToolPolicy,
  extractAgentOutput,
  extractCompletedToolMetadata,
} from '@/executor/handlers/agent/agent-handler'
import type { AgentToolConfig } from '@/executor/handlers/agent/types'
import type { ExecutionSubmissionSource } from '@/executor/types'

export interface ProviderRouteBody {
  provider?: string
  providerNamespace?: 'ai'
  providerType?: 'ai'
  model?: string
  instructions?: string
  messages?: MessageInput[]
  tools?: AgentToolConfig[]
  modelSettings?: AgentExecutionOptions['modelSettings']
  structuredOutput?: { schema: Record<string, any> }
  apiKey?: string
  providerOptions?: Record<string, Record<string, any>>
  workflowId?: string
  workspaceId?: string
  workflowLogId?: string
  submissionSource?: ExecutionSubmissionSource
  stream?: boolean
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  isDeployedContext?: boolean
}

export async function handleAIProviderRequest({
  body,
  requestId,
  authUserId,
  signal: requestSignal,
}: {
  body: ProviderRouteBody
  requestId: string
  authUserId?: string
  signal?: AbortSignal
}) {
  if (!body.model) return NextResponse.json({ error: 'Model is required' }, { status: 400 })
  assertListedModel(body.model)
  const model = body.model
  const startedAt = new Date()
  const configuredTools = (body.tools || []).filter((tool) => tool.usageControl !== 'none')
  const policy = createForcedToolPolicy(configuredTools)
  const abortController = new AbortController()
  const signal = AbortSignal.any([
    AbortSignal.timeout(120000),
    abortController.signal,
    ...(requestSignal ? [requestSignal] : []),
  ])
  const { tools, toolRuns } = createAgentToolSet(
    configuredTools,
    { ...body, userId: authUserId },
    undefined,
    { signal, abort: (reason) => abortController.abort(reason) }
  )
  const messages = await normalizeNativeMediaMessages(body.messages ?? [], {
    actorUserId: authUserId,
    workspaceId: body.workspaceId,
    signal,
  })
  const work = await prepareModelRequest(
    {
      model,
      actorUserId: authUserId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      runId: requestId,
      purpose: 'workflow-provider',
      signal,
    },
    {
      apiKey: body.apiKey,
      modelSettings: body.modelSettings,
      providerOptions: body.providerOptions,
    }
  )
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: requestId,
    name: 'Workflow generation',
    instructions: body.instructions || '',
    model: work.model,
    tools,
    mastra: work.mastra,
  })
  const options: AgentExecutionOptions<any> = {
    ...work.options,
    maxSteps: 20,
    structuredOutput: body.structuredOutput
      ? { schema: toStandardSchema(body.structuredOutput.schema), errorStrategy: 'strict' }
      : undefined,
    activeTools: Object.keys(tools),
    prepareStep: policy.prepareStep,
  }
  const complete = async (result: any) => {
    await work.usage.verifyComplete()
    const accounting = work.accounting()
    policy.assertComplete(result.steps)
    return extractAgentOutput(
      result,
      model,
      accounting,
      toolRuns,
      !!body.structuredOutput,
      startedAt
    )
  }
  if (!body.stream) {
    try {
      return NextResponse.json(
        await complete(
          options.structuredOutput
            ? await agent.generate(messages, {
                ...options,
                structuredOutput: options.structuredOutput,
              })
            : await agent.generate(messages, { ...options, structuredOutput: undefined })
        )
      )
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      Object.assign(failure, work.accounting(), { model }, extractCompletedToolMetadata(toolRuns))
      throw failure
    }
  }
  const output = options.structuredOutput
    ? await agent.stream(messages, { ...options, structuredOutput: options.structuredOutput })
    : await agent.stream(messages, { ...options, structuredOutput: undefined })
  const reader = output.fullStream.getReader()
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) {
              controller.enqueue(
                encodeSSE({
                  type: 'workflow-output',
                  output: await complete(await output.getFullOutput()),
                })
              )
              controller.close()
              return
            }
            const event = projectNativeModelEvent(chunk.value, body.apiKey)
            if (event) {
              controller.enqueue(encodeSSE(event))
              return
            }
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          Object.assign(
            failure,
            work.accounting(),
            { model },
            extractCompletedToolMetadata(toolRuns)
          )
          controller.error(failure)
        }
      },
      async cancel(reason) {
        abortController.abort(reason)
        await reader.cancel(reason)
        work.accounting()
      },
    }),
    { headers: SSE_HEADERS }
  )
}
