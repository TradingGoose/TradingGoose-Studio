import type { ExecutionEnvironment, ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'

export function createTriggerObject(
  type: ExecutionTrigger['type'],
  additionalData?: Record<string, unknown>
): ExecutionTrigger {
  const sourceOverrideRaw =
    typeof additionalData?.source === 'string' ? additionalData.source.trim() : ''
  const source = sourceOverrideRaw || type

  const { source: _source, ...dataWithoutSource } = additionalData ?? {}
  const hasData = Object.keys(dataWithoutSource).length > 0

  return {
    type,
    source,
    timestamp: new Date().toISOString(),
    ...(hasData ? { data: dataWithoutSource } : {}),
  }
}

export function createEnvironmentObject(
  workflowId: string,
  executionId: string,
  userId?: string,
  workspaceId?: string,
  variables?: Record<string, string>
): ExecutionEnvironment {
  return {
    variables: variables || {},
    workflowId,
    executionId,
    userId: userId || '',
    workspaceId: workspaceId || '',
  }
}

export async function loadWorkflowStateForExecution(workflowId: string): Promise<WorkflowState> {
  const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
  const workflowData = normalizedData || (await loadDeployedWorkflowState(workflowId))

  return {
    blocks: workflowData.blocks || {},
    edges: workflowData.edges || [],
    loops: workflowData.loops || {},
    parallels: workflowData.parallels || {},
  }
}

export function calculateCostSummary(
  traceSpans: any[],
  workflowExecutionChargeUsd = 0,
  workflowModelCostMultiplier = 1
): {
  totalCost: number
  totalInputCost: number
  totalOutputCost: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  baseExecutionCharge: number
  modelCost: number
  models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { prompt: number; completion: number; total: number }
    }
  >
} {
  if (!traceSpans || traceSpans.length === 0) {
    return {
      totalCost: workflowExecutionChargeUsd,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      baseExecutionCharge: workflowExecutionChargeUsd,
      modelCost: 0,
      models: {},
    }
  }

  // Recursively collect all spans with cost information from the trace span tree
  const collectCostSpans = (spans: any[]): any[] => {
    const costSpans: any[] = []

    for (const span of spans) {
      if (span.cost) {
        costSpans.push(span)
      }

      if (span.children && Array.isArray(span.children)) {
        costSpans.push(...collectCostSpans(span.children))
      }
    }

    return costSpans
  }

  const costSpans = collectCostSpans(traceSpans)
  const modelCostMultiplier =
    Number.isFinite(workflowModelCostMultiplier) && workflowModelCostMultiplier >= 0
      ? workflowModelCostMultiplier
      : 1

  let totalCost = 0
  let totalInputCost = 0
  let totalOutputCost = 0
  let totalTokens = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { prompt: number; completion: number; total: number }
    }
  > = {}

  for (const span of costSpans) {
    const scaledInputCost = (span.cost.input || 0) * modelCostMultiplier
    const scaledOutputCost = (span.cost.output || 0) * modelCostMultiplier
    const scaledTotalCost = (span.cost.total || 0) * modelCostMultiplier

    totalCost += scaledTotalCost
    totalInputCost += scaledInputCost
    totalOutputCost += scaledOutputCost
    // Tokens are at span.tokens, not span.cost.tokens
    totalTokens += span.tokens?.total || 0
    totalPromptTokens += span.tokens?.prompt || 0
    totalCompletionTokens += span.tokens?.completion || 0

    // Aggregate model-specific costs - model is at span.model, not span.cost.model
    if (span.model) {
      const model = span.model
      if (!models[model]) {
        models[model] = {
          input: 0,
          output: 0,
          total: 0,
          tokens: { prompt: 0, completion: 0, total: 0 },
        }
      }
      models[model].input += scaledInputCost
      models[model].output += scaledOutputCost
      models[model].total += scaledTotalCost
      models[model].tokens.prompt += span.tokens?.prompt || 0
      models[model].tokens.completion += span.tokens?.completion || 0
      models[model].tokens.total += span.tokens?.total || 0
    }
  }

  const modelCost = totalCost
  totalCost += workflowExecutionChargeUsd

  return {
    totalCost,
    totalInputCost,
    totalOutputCost,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    baseExecutionCharge: workflowExecutionChargeUsd,
    modelCost,
    models,
  }
}
