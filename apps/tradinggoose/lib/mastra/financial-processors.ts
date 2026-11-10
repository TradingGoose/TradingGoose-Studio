import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { InputProcessor, OutputProcessor } from '@mastra/core/processors'
import { occurrenceKey } from '@tradinggoose/billing'
import { addMoney } from '@tradinggoose/billing/money'
import {
  acceptFinancialModelStep,
  admitFinancialModelStep,
  createFinancialInvocation,
  type FinancialBinding,
  type ModelOccurrence,
} from '@/lib/billing/native-finance'
import { assertNativeToolArguments } from './options'
import { type NativeUsage, selectNativeUsage, sumNativeUsage } from './usage'

const successfulFinish = (reason: unknown): reason is 'stop' | 'tool-calls' | 'length' =>
  reason === 'stop' || reason === 'tool-calls' || reason === 'length'

/** Request-local processors; their durable financial references never grant execution authority. */
export async function financialProcessors(
  scope: {
    actorUserId?: string
    workspaceId?: string
    workflowId?: string
    runId: string
    purpose: string
    signal?: AbortSignal
  },
  captureResponse?: (observation: {
    key: string
    occurrence: ModelOccurrence
    readResponse: () => MastraDBMessage[]
  }) => void,
  original?: { binding?: FinancialBinding; operationKey?: string }
) {
  if (!scope.actorUserId)
    throw new Error('An authenticated financial actor is required before model contact')
  if (
    original?.binding &&
    (original.binding.actorUserId !== scope.actorUserId ||
      original.binding.workspaceId !== (scope.workspaceId ?? null) ||
      original.binding.workflowId !== (scope.workflowId ?? null) ||
      original.binding.runId !== scope.runId ||
      original.binding.purpose !== scope.purpose)
  )
    throw new Error('Original financial invocation does not match the authenticated scope')
  const binding = original?.binding
    ? { ...original.binding }
    : await createFinancialInvocation({
        ...scope,
        actorUserId: scope.actorUserId,
        ...(original?.operationKey ? { operationKey: original.operationKey } : {}),
      })
  let active: ModelOccurrence | undefined
  let failure: { error: unknown } | undefined
  const acknowledgements = new Map<
    string,
    {
      pendingAdmissions: number
      acknowledged: boolean
      usage?: NativeUsage
      finishReason?: 'stop' | 'tool-calls' | 'length'
      appliedUsd?: string
    }
  >()
  const recordFailure = (error: unknown) => {
    failure ??= { error }
  }
  const assertActive = () => {
    scope.signal?.throwIfAborted()
    if (failure) throw failure.error
  }
  const input: InputProcessor = {
    id: 'trusted-financial-admission',
    async processInputStep(args) {
      try {
        assertActive()
        if (args.runId !== undefined && args.runId !== scope.runId)
          throw new Error('Native run does not match its trusted financial invocation')
        const occurrence = {
          stepNumber: args.stepNumber,
          retryCount: args.retryCount,
          runId: args.runId,
        }
        const key = occurrenceKey(binding, occurrence)
        const acknowledgement = acknowledgements.get(key) ?? {
          pendingAdmissions: 0,
          acknowledged: false,
        }
        acknowledgements.set(key, acknowledgement)
        acknowledgement.pendingAdmissions += 1
        await admitFinancialModelStep(binding, occurrence)
        acknowledgement.pendingAdmissions -= 1
        active = occurrence
        assertActive()
      } catch (error) {
        failure ??= { error }
        throw error
      }
    },
    processLLMResponse(args) {
      const occurrence = active
      if (
        !occurrence ||
        occurrence.stepNumber !== args.stepNumber ||
        occurrence.retryCount !== args.retryCount
      ) {
        recordFailure(new Error('Model response does not match its admitted financial occurrence'))
        return
      }
      const acknowledgement = acknowledgements.get(occurrenceKey(binding, occurrence))!
      for (const chunk of args.chunks) {
        if (chunk.type === 'error' || chunk.type === 'abort') {
          const payload = chunk.payload
          recordFailure(
            payload && typeof payload === 'object' && 'error' in payload
              ? payload.error
              : new Error('Native model contact did not complete successfully')
          )
        }
        if (chunk.type !== 'finish') continue
        const payload = chunk.payload
        const reason =
          payload &&
          typeof payload === 'object' &&
          'stepResult' in payload &&
          payload.stepResult &&
          typeof payload.stepResult === 'object' &&
          'reason' in payload.stepResult
            ? payload.stepResult.reason
            : undefined
        if (!successfulFinish(reason))
          recordFailure(new Error('Native model contact has no successful completion'))
        else if (acknowledgement.finishReason && acknowledgement.finishReason !== reason)
          recordFailure(new Error('Native model completion evidence changed'))
        else acknowledgement.finishReason = reason
      }
    },
    processAPIError(args) {
      if (!active || active.stepNumber !== args.stepNumber || active.retryCount !== args.retryCount)
        recordFailure(new Error('Native API failure does not match its financial occurrence'))
      else recordFailure(args.error)
    },
  }
  const output: OutputProcessor = {
    id: 'trusted-financial-acceptance',
    async processOutputStream(args) {
      if (args.part.type === 'error' || args.part.type === 'abort') {
        if (!active || active.retryCount !== args.retryCount || args.part.runId !== scope.runId)
          recordFailure(new Error('Native stream failure does not match its financial occurrence'))
        else
          recordFailure(
            args.part.type === 'error'
              ? args.part.payload.error
              : new Error('Native model contact was aborted')
          )
      }
      // Installed core delivers deferred errors before output-step capture. Preserve that
      // capture rather than throwing here; the latch still forbids tools and later admission.
      return args.part
    },
    async processOutputStep(args) {
      try {
        // An abort after a completed response does not erase its incurred financial facts.
        const occurrence = active
        if (!occurrence && failure) throw failure.error
        if (
          !occurrence ||
          occurrence.stepNumber !== args.stepNumber ||
          occurrence.retryCount !== args.retryCount ||
          (occurrence.runId !== undefined && occurrence.runId !== scope.runId)
        )
          throw new Error('Missing admitted native model occurrence')
        const key = occurrenceKey(binding, occurrence)
        const acknowledgement = acknowledgements.get(key)!
        // Completed usage survives an unknown/rejected transaction acknowledgement.
        // Repeated observation of the same occurrence can fill missing fields, never add it twice.
        acknowledgement.usage = { ...selectNativeUsage(args.usage), ...acknowledgement.usage }
        let captureFailure: { error: unknown } | undefined
        try {
          captureResponse?.({
            key,
            occurrence: { ...occurrence },
            readResponse: () => args.messageList.get.response.db(),
          })
        } catch (error) {
          // A history projection failure cannot erase work already incurred by the model.
          captureFailure = { error }
        }
        if (failure) throw failure.error
        if (
          !successfulFinish(args.finishReason) ||
          acknowledgement.finishReason !== args.finishReason
        )
          throw new Error('Native model contact has no proven successful completion')
        const receipt = await acceptFinancialModelStep(binding, {
          ...occurrence,
          usage: args.usage,
        })
        acknowledgement.appliedUsd = receipt.appliedUsd
        acknowledgements.get(key)!.acknowledged = true
        if (captureFailure) throw captureFailure.error
        for (const call of args.toolCalls ?? []) assertNativeToolArguments(call.args)
        assertActive()
        return args.messageList
      } catch (error) {
        failure ??= { error }
        throw error
      }
    },
  }
  return {
    binding,
    inputProcessors: [input],
    outputProcessors: [output],
    getLastOccurrence(): ModelOccurrence | undefined {
      return active && { ...active }
    },
    getFinancialFact() {
      const accepted = [...acknowledgements.values()].filter((value) => value.acknowledged)
      if (!accepted.length) return undefined
      return {
        accepted: true as const,
        modelUsd: 'unavailable' as const,
        appliedUsd: addMoney(...accepted.map((value) => value.appliedUsd!)),
      }
    },
    getUsage(): NativeUsage {
      return sumNativeUsage([...acknowledgements.values()].map(({ usage }) => ({ usage })))
    },
    async verifyComplete() {
      assertActive()
      if (
        !acknowledgements.size ||
        [...acknowledgements.values()].some(
          (value) => value.pendingAdmissions || !value.acknowledged
        )
      )
        throw new Error('The native result has unacknowledged financial acceptance')
    },
  }
}
