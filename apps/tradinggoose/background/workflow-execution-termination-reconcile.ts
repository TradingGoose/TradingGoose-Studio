import { GoogleGenAI } from '@google/genai'
import { runs, task } from '@trigger.dev/sdk'
import { refreshWorkflowExecutionAttemptParticipant } from '@/lib/execution/workflow-execution-deadline-repository'
import {
  cancelWorkflowExecutionAtomically,
  claimWorkflowOperationsForTermination,
  getWorkflowExecutionProjection,
  listOpenWorkflowExecutionAttemptsForRoot,
  reconcileWorkflowDeadlineTermination,
  recordWorkflowAttemptTerminalObservation,
  recordWorkflowInfrastructureCandidate,
  recordWorkflowOperationObservation,
  scheduleWorkflowTerminationReconcile,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import {
  completeWorkflowExecutionOutbox,
  failWorkflowExecutionOutbox,
  type WorkflowExecutionOutboxClaim,
} from '@/lib/execution/workflow-execution-outbox'
import { decryptSecret } from '@/lib/utils-server'

type RemoteTerminalState = 'canceled' | 'completed' | 'failed'

function reconcileProviderFetch(input: string | URL | Request, init?: RequestInit) {
  return globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(10_000) })
}

async function reconcileDurableToolOperation(operation: {
  adapterKind: string
  remoteOperationId: string | null
  observation: Record<string, unknown> | null
}): Promise<{ state?: RemoteTerminalState; observation: Record<string, unknown> } | null> {
  if (!operation.remoteOperationId) return null
  const encrypted = operation.observation?._credentialLease
  if (typeof encrypted !== 'string') return null
  const { decrypted: apiKey } = await decryptSecret(encrypted)
  const id = operation.remoteOperationId

  if (operation.adapterKind === 'apify_run') {
    await reconcileProviderFetch(`https://api.apify.com/v2/actor-runs/${id}/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const response = await reconcileProviderFetch(`https://api.apify.com/v2/actor-runs/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) return { observation: { providerStatus: response.status } }
    const status = (await response.json()).data?.status
    return {
      state:
        status === 'SUCCEEDED'
          ? 'completed'
          : status === 'ABORTED'
            ? 'canceled'
            : status === 'FAILED' || status === 'TIMED-OUT'
              ? 'failed'
              : undefined,
      observation: { providerStatus: status },
    }
  }

  if (operation.adapterKind === 'exa_research') {
    const response = await reconcileProviderFetch(`https://api.exa.ai/research/v0/tasks/${id}`, {
      headers: { 'x-api-key': apiKey },
    })
    if (!response.ok) return { observation: { providerStatus: response.status } }
    const status = (await response.json()).status
    return {
      state:
        status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'canceled' || status === 'cancelled'
              ? 'canceled'
              : undefined,
      observation: { providerStatus: status },
    }
  }

  if (operation.adapterKind === 'firecrawl_crawl') {
    const cancellation = await reconcileProviderFetch(`https://api.firecrawl.dev/v1/crawl/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (cancellation.ok) {
      try {
        const status = (await cancellation.json()).status
        if (status === 'canceled' || status === 'cancelled') {
          return { state: 'canceled', observation: { providerStatus: status } }
        }
      } catch {
        // A malformed cancellation response falls back to status observation.
      }
    }
    const response = await reconcileProviderFetch(`https://api.firecrawl.dev/v1/crawl/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) return { observation: { providerStatus: response.status } }
    const status = (await response.json()).status
    return {
      state:
        status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'canceled' || status === 'cancelled'
              ? 'canceled'
              : undefined,
      observation: { providerStatus: status },
    }
  }

  if (operation.adapterKind.startsWith('browser_use_')) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': apiKey,
    }
    if (operation.adapterKind === 'browser_use_profile_session') {
      const response = await reconcileProviderFetch(
        `https://api.browser-use.com/api/v2/sessions/${id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ action: 'stop' }),
        }
      )
      return {
        state:
          response.ok || response.status === 404 || response.status === 410
            ? 'canceled'
            : undefined,
        observation: { providerStatus: response.status },
      }
    }
    await reconcileProviderFetch(`https://api.browser-use.com/api/v2/tasks/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ action: 'stop_task_and_session' }),
    })
    const response = await reconcileProviderFetch(
      `https://api.browser-use.com/api/v2/tasks/${id}`,
      { headers }
    )
    if (!response.ok) return { observation: { providerStatus: response.status } }
    const status = (await response.json()).status
    const taskState =
      status === 'finished'
        ? 'completed'
        : status === 'stopped'
          ? 'canceled'
          : status === 'failed'
            ? 'failed'
            : undefined
    if (!taskState) return { observation: { providerStatus: status } }
    const sessionId = operation.observation?.sessionId
    if (typeof sessionId === 'string') {
      const stopped = await reconcileProviderFetch(
        `https://api.browser-use.com/api/v2/sessions/${sessionId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ action: 'stop' }),
        }
      )
      if (!stopped.ok && stopped.status !== 404 && stopped.status !== 410) {
        return { observation: { providerStatus: status, sessionId } }
      }
    }
    return { state: taskState, observation: { providerStatus: status, sessionId } }
  }
  return null
}

export async function reconcileWorkflowTermination(rootExecutionId: string) {
  const terminal = await getWorkflowExecutionProjection(rootExecutionId)
  const attempts = await listOpenWorkflowExecutionAttemptsForRoot(rootExecutionId)
  for (const attempt of attempts) {
    if (!attempt.drainRunId) continue
    try {
      const run = await runs.retrieve(attempt.drainRunId)
      if (
        ['FAILED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT'].includes(run.status) &&
        run.finishedAt
      ) {
        await recordWorkflowInfrastructureCandidate({
          attemptId: attempt.id,
          rootExecutionId,
          failedAt: run.finishedAt,
          diagnostics: { triggerRunId: run.id, status: run.status },
        })
        await recordWorkflowAttemptTerminalObservation({
          attemptId: attempt.id,
          rootExecutionId,
          state: 'failed',
          finishedAt: run.finishedAt,
        })
      } else if (['COMPLETED', 'CANCELED'].includes(run.status) && run.finishedAt) {
        await recordWorkflowAttemptTerminalObservation({
          attemptId: attempt.id,
          rootExecutionId,
          state: run.status === 'COMPLETED' ? 'completed' : 'canceled',
          finishedAt: run.finishedAt,
        })
      } else if (!['COMPLETED', 'CANCELED'].includes(run.status)) {
        await refreshWorkflowExecutionAttemptParticipant(attempt.id)
      }
    } catch {
      // An unavailable Trigger snapshot is unresolved, not terminal.
    }
  }
  const operations = await claimWorkflowOperationsForTermination(rootExecutionId)
  for (const operation of operations) {
    const isDurableTool = [
      'apify_run',
      'exa_research',
      'firecrawl_crawl',
      'browser_use_profile_session',
      'browser_use_task',
      'browser_use_task_with_profile_session',
    ].includes(operation.adapterKind)
    try {
      const durableTool = await reconcileDurableToolOperation(operation)
      if (durableTool) {
        await recordWorkflowOperationObservation({
          id: operation.id,
          fencingToken: operation.fencingToken,
          ...durableTool,
        })
        continue
      }
    } catch {
      // Credential and provider failures remain unresolved and retry.
    }
    if (isDurableTool) {
      await recordWorkflowOperationObservation({
        id: operation.id,
        fencingToken: operation.fencingToken,
        observation: { adapter: operation.adapterKind, outcome: 'unknown' },
      })
      continue
    }
    if (operation.adapterKind === 'gemini_interaction_status' && operation.remoteOperationId) {
      const observation =
        operation.observation && typeof operation.observation === 'object'
          ? (operation.observation as Record<string, unknown>)
          : {}
      if (
        observation.providerType === 'vertex' &&
        typeof observation.vertexProject === 'string' &&
        typeof observation.vertexLocation === 'string'
      ) {
        try {
          const ai = new GoogleGenAI({
            vertexai: true,
            project: observation.vertexProject,
            location: observation.vertexLocation,
          })
          const interaction = await ai.interactions.get(operation.remoteOperationId)
          const state =
            interaction.status === 'completed'
              ? 'completed'
              : interaction.status === 'cancelled'
                ? 'canceled'
                : interaction.status === 'failed' || interaction.status === 'incomplete'
                  ? 'failed'
                  : undefined
          await recordWorkflowOperationObservation({
            id: operation.id,
            fencingToken: operation.fencingToken,
            state,
            observation: {
              ...observation,
              providerStatus: interaction.status,
            },
          })
          continue
        } catch {
          // Transient provider/credential failures remain nonterminal and retry.
        }
      }
    }
    if (
      operation.capability === 'native_cancel_status' &&
      operation.remoteOperationId &&
      terminal?.actorUserId
    ) {
      const outcome = await cancelWorkflowExecutionAtomically({
        pendingExecutionId: operation.remoteOperationId,
        actorUserId: terminal.actorUserId,
        descendantOnly: true,
      })
      await recordWorkflowOperationObservation({
        id: operation.id,
        fencingToken: operation.fencingToken,
        state: outcome.status === 'finished' ? 'canceled' : undefined,
        observation: { adapter: operation.adapterKind, outcome: outcome.status },
      })
      continue
    }
    // Local, status-only, and uncancelable work crosses the barrier only when its
    // live adapter or authoritative provider observer confirms a terminal state.
    await recordWorkflowOperationObservation({
      id: operation.id,
      fencingToken: operation.fencingToken,
      observation: { adapter: operation.adapterKind, outcome: 'unknown' },
    })
  }
  const result = await reconcileWorkflowDeadlineTermination(rootExecutionId)
  if (!result) {
    await scheduleWorkflowTerminationReconcile(rootExecutionId, operations.length > 0)
  }
  return result
}

export const workflowExecutionTerminationReconcile = task({
  id: 'workflow-execution-termination-reconcile',
  retry: { maxAttempts: 10 },
  run: async (claim: WorkflowExecutionOutboxClaim) => {
    const { rootExecutionId } = claim
    try {
      const result = await reconcileWorkflowTermination(rootExecutionId)
      await completeWorkflowExecutionOutbox(claim)
      return result
    } catch (error) {
      await failWorkflowExecutionOutbox({
        ...claim,
        error: error instanceof Error ? error.message : 'Termination reconciliation failed',
      })
      throw error
    }
  },
})
