import type { ChatContext } from '@/stores/copilot/types'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'

export function buildCurrentTargetsContext({
  activeWorkflowId,
  pairColor = 'gray',
  pairContext,
}: {
  activeWorkflowId?: string | null
  pairColor?: PairColor
  pairContext?: PairColorContext | null
}): ChatContext | null {
  const usePairedTargets = pairColor !== 'gray'
  const workflowId = (usePairedTargets ? pairContext?.workflowId : undefined) ?? activeWorkflowId
  const currentTargets = {
    workflowId: workflowId ?? undefined,
    skillId: usePairedTargets ? (pairContext?.skillId ?? undefined) : undefined,
    customToolId: usePairedTargets ? (pairContext?.customToolId ?? undefined) : undefined,
    mcpServerId: usePairedTargets ? (pairContext?.mcpServerId ?? undefined) : undefined,
    indicatorId: usePairedTargets ? (pairContext?.indicatorId ?? undefined) : undefined,
    pineIndicatorId: usePairedTargets ? (pairContext?.pineIndicatorId ?? undefined) : undefined,
  }

  const hasTargets = Object.values(currentTargets).some(
    (value) => typeof value === 'string' && value.trim().length > 0
  )
  if (!hasTargets) {
    return null
  }

  return {
    kind: 'current_targets',
    label: 'Current Targets',
    ...currentTargets,
  }
}

export function appendCurrentTargetsContext(
  contexts: ChatContext[] | undefined,
  currentTargetsContext: ChatContext | null
): ChatContext[] | undefined {
  const baseContexts = Array.isArray(contexts)
    ? contexts.filter((context) => context.kind !== 'current_targets')
    : []

  if (!currentTargetsContext) {
    return baseContexts.length > 0 ? baseContexts : undefined
  }

  return [...baseContexts, currentTargetsContext]
}

export function isHiddenCopilotContext(context: Pick<ChatContext, 'kind'> | null | undefined) {
  return context?.kind === 'current_workflow' || context?.kind === 'current_targets'
}
