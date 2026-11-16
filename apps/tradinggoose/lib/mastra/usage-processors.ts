import { randomUUID } from 'node:crypto'
import type { MessageList } from '@mastra/core/agent/message-list'
import type { InputProcessor, OutputProcessor } from '@mastra/core/processors'
import type { LanguageModelUsage } from '@mastra/core/stream'
import { parseNativeToolArguments } from './options'
import { type NativeCost, type NativeUsage, sumNativeCosts, sumNativeUsage } from './usage'

export interface NativeUsageScope {
  actorUserId?: string
  runId: string
  funding: 'byok' | 'account'
  signal?: AbortSignal
}

export interface NativeUsageAccounting {
  assertAllowed(): Promise<void>
  begin(attemptId: string): Promise<unknown>
  record(
    usage: Partial<LanguageModelUsage>,
    providerMetadata: Record<string, unknown> | undefined,
    attemptId: string
  ): Promise<NativeCost>
}

/** Native model steps use Studio's existing admission and usage ledger. */
export async function usageProcessors(scope: NativeUsageScope, accounting: NativeUsageAccounting) {
  if (!scope.actorUserId) throw new Error('An authenticated model actor is required')
  const invocationId = randomUUID()
  const steps = new Map<string, { stepNumber: number; usage?: NativeUsage; cost: NativeCost }>()
  const aggregateCost = (costs: NativeCost[]) => {
    const cost = sumNativeCosts(costs)
    return scope.funding === 'byok' ? { ...cost, accountCost: null } : cost
  }
  const retainRunId = (messageList: MessageList) => {
    for (const message of messageList.get.response.db()) {
      if (message.role !== 'assistant' || message.content.metadata?.runId) continue
      messageList.add(
        {
          ...message,
          content: {
            ...message.content,
            metadata: { ...message.content.metadata, runId: scope.runId },
          },
        },
        'response'
      )
    }
    return messageList
  }
  let failure: unknown
  const input: InputProcessor = {
    id: 'studio-usage-admission',
    async processInputStep() {
      if (failure) throw failure
      try {
        await accounting.assertAllowed()
      } catch (error) {
        failure = error
        throw error
      }
    },
    async processLLMRequest({ stepNumber, retryCount, abortSignal }) {
      try {
        scope.signal?.throwIfAborted()
        abortSignal?.throwIfAborted()
        const key = `${scope.runId}:${invocationId}:${stepNumber}:${retryCount}`
        await accounting.begin(key)
        if (!steps.has(key)) steps.set(key, { stepNumber, cost: { status: 'unavailable' } })
      } catch (error) {
        failure = error
        throw error
      }
    },
  }
  const output: OutputProcessor = {
    id: 'studio-usage-accounting',
    async processOutputStep(args) {
      retainRunId(args.messageList)
      try {
        if (failure) throw failure
        const key = `${scope.runId}:${invocationId}:${args.stepNumber}:${args.retryCount}`
        if (!steps.get(key)?.usage) {
          const step = {
            stepNumber: args.stepNumber,
            usage: sumNativeUsage([{ usage: args.usage }]),
            cost: { status: 'unavailable' } as NativeCost,
          }
          steps.set(key, step)
          step.cost = await accounting.record(args.usage, args.providerMetadata, key)
          const response = args.messageList.get.response
            .db()
            .filter((message) => message.role === 'assistant')
            .at(-1)
          if (response) {
            const metadata = response.content.metadata ?? {}
            args.messageList.add(
              {
                ...response,
                content: {
                  ...response.content,
                  metadata: {
                    ...metadata,
                    usage: sumNativeUsage([
                      { usage: metadata.usage as NativeUsage | undefined },
                      step,
                    ]),
                    cost: aggregateCost([
                      ...(metadata.cost ? [metadata.cost as NativeCost] : []),
                      ...[...steps.values()]
                        .filter(
                          (attempt) => attempt.stepNumber === args.stepNumber && !attempt.usage
                        )
                        .map((attempt) => attempt.cost),
                      step.cost,
                    ]),
                  },
                },
              },
              'response'
            )
          }
        }
        for (const call of args.toolCalls ?? []) parseNativeToolArguments(call.args)
        scope.signal?.throwIfAborted()
        return args.messageList
      } catch (error) {
        failure = error
        throw error
      }
    },
    processOutputResult: ({ messageList }) => retainRunId(messageList),
  }
  return {
    inputProcessors: [input],
    outputProcessors: [output],
    getUsage: () => sumNativeUsage([...steps.values()]),
    getCost: () => aggregateCost([...steps.values()].map((step) => step.cost)),
    async verifyComplete() {
      if (failure) throw failure
      scope.signal?.throwIfAborted()
      if (!steps.size) throw new Error('Model generation has no completed steps')
      const completedSteps = new Set(
        [...steps.values()].filter((step) => step.usage).map((step) => step.stepNumber)
      )
      if ([...steps.values()].some((step) => !completedSteps.has(step.stepNumber)))
        throw new Error('Model generation has an unfinished provider request')
    },
  }
}
