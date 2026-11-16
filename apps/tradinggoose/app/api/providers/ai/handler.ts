import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import type { MessageInput } from '@mastra/core/agent/message-list'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizeNativeMediaMessages } from '@/lib/mastra/media'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'

const requestSchema = z.strictObject({
  providerNamespace: z.literal('ai').optional(),
  model: z.string().min(1),
  instructions: z.string().optional(),
  messages: z.array(z.custom<MessageInput>()).optional(),
  modelSettings: z.custom<AgentExecutionOptions['modelSettings']>().optional(),
  apiKey: z.string().optional(),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
})

export type ProviderRouteBody = z.infer<typeof requestSchema>

/** The LLM Chat tool uses the shared native request and accounting contract. */
export async function handleAIProviderRequest({
  body,
  requestId,
  authUserId,
  executionId,
  signal: requestSignal,
}: {
  body: ProviderRouteBody
  requestId: string
  authUserId?: string
  executionId?: string
  signal?: AbortSignal
}) {
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid AI provider request' }, { status: 400 })
  body = parsed.data
  await assertListedModel(body.model)
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
      executionId,
      runId: requestId,
      purpose: 'workflow-provider',
      funding: body.apiKey ? 'byok' : 'account',
      signal,
    },
    {
      apiKey: body.apiKey,
      modelSettings: body.modelSettings,
    }
  )
  try {
    const agent = new Agent({
      id: requestId,
      name: 'LLM Chat',
      instructions: body.instructions || '',
      model: work.model,
      mastra: work.mastra,
    })
    const result = await agent.generate(messages, work.options)
    return NextResponse.json({ content: result.text, model, ...(await work.complete(result)) })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    throw Object.assign(failure, { model, ...work.accounting() })
  }
}
