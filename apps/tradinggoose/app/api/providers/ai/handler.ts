import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import type { MessageInput } from '@mastra/core/agent/message-list'
import { NextResponse } from 'next/server'
import { normalizeNativeMediaMessages } from '@/lib/mastra/media'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion } from '@/lib/mastra/result'

export interface ProviderRouteBody {
  providerNamespace?: 'ai'
  model?: string
  instructions?: string
  messages?: MessageInput[]
  modelSettings?: AgentExecutionOptions['modelSettings']
  apiKey?: string
  providerOptions?: Record<string, Record<string, any>>
  workflowId?: string
  workspaceId?: string
}

/** The LLM Chat tool uses the shared native request and accounting contract. */
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
  const signal = AbortSignal.any([
    AbortSignal.timeout(120000),
    ...(requestSignal ? [requestSignal] : []),
  ])
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
  try {
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: requestId,
      name: 'LLM Chat',
      instructions: body.instructions || '',
      model: work.model,
      mastra: work.mastra,
    })
    const result = await agent.generate(messages, work.options)
    assertNativeCompletion(result)
    await work.usage.verifyComplete()
    return NextResponse.json({ content: result.text, model, ...work.accounting() })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    throw Object.assign(failure, { model, ...work.accounting() })
  }
}
