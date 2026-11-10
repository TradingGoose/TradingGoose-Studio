import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import type { MessageInput } from '@mastra/core/agent/message-list'
import { toStandardSchema } from '@mastra/core/schema'
import { NextResponse } from 'next/server'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { projectNativeModelEvent } from '@/lib/mastra/events'
import { financialProcessors } from '@/lib/mastra/financial-processors'
import { normalizeNativeMediaMessages } from '@/lib/mastra/media'
import { NATIVE_AGENT_POLICY, trustedModelSettings, trustedPrepareStep } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { getMastra } from '@/lib/mastra/runtime'
import { resultAccounting, selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import {
  createAgentToolSet,
  createForcedToolPolicy,
  extractAgentOutput,
  extractCompletedToolMetadata,
  parseNativeProviderOptions,
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
  const mastra = await getMastra()
  const finance = await financialProcessors({
    actorUserId: authUserId,
    workspaceId: body.workspaceId,
    workflowId: body.workflowId,
    runId: requestId,
    purpose: 'workflow-provider',
    signal,
  })
  const admittedModel = createConfiguredLanguageModel(model, body.apiKey)
  const agent = new Agent({
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    ...NATIVE_AGENT_POLICY,
    id: requestId,
    name: 'Workflow generation',
    instructions: body.instructions || '',
    model: admittedModel,
    tools,
    mastra,
  })
  const steps: any[] = []
  const options: AgentExecutionOptions<any> = {
    runId: requestId,
    maxSteps: 20,
    abortSignal: signal,
    modelSettings: trustedModelSettings(body.modelSettings),
    maxProcessorRetries: 0,
    structuredOutput: body.structuredOutput
      ? { schema: toStandardSchema(body.structuredOutput.schema), errorStrategy: 'strict' }
      : undefined,
    providerOptions: parseNativeProviderOptions(body.providerOptions),
    activeTools: Object.keys(tools),
    prepareStep: trustedPrepareStep(admittedModel, policy.prepareStep),
    onStepFinish: (step) => {
      steps.push(step)
    },
    tracingOptions: {
      metadata: { userId: authUserId, resourceId: body.workspaceId, runId: requestId },
    },
  }
  const capture = (usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) =>
    resultAccounting(selectNativeUsage(usage, finance.getUsage(), sumNativeUsage(steps)))
  const complete = async (result: any) => {
    await finance.verifyComplete()
    const accounting = await capture(result.totalUsage || result.usage)
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
      Object.assign(failure, await capture(), { model }, extractCompletedToolMetadata(toolRuns))
      throw failure
    }
  }
  const streamOptions = {
    ...options,
    abortSignal: AbortSignal.any([options.abortSignal!, abortController.signal]),
  }
  const output = streamOptions.structuredOutput
    ? await agent.stream(messages, {
        ...streamOptions,
        structuredOutput: streamOptions.structuredOutput,
      })
    : await agent.stream(messages, { ...streamOptions, structuredOutput: undefined })
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
          Object.assign(failure, await capture(), { model }, extractCompletedToolMetadata(toolRuns))
          controller.error(failure)
        }
      },
      async cancel(reason) {
        abortController.abort(reason)
        await reader.cancel(reason)
        await capture()
      },
    }),
    { headers: SSE_HEADERS }
  )
}
