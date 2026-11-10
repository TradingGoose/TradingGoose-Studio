import { db } from '@tradinggoose/db'
import { workflow, workflowFolder } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { ExecutionEnvironment, ExecutionTrigger } from '@/lib/logs/types'
import { getInferenceFacts } from '@/lib/mastra/result'
import { isWorkflowBlockType } from '@/executor/consts'

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
  workspaceId?: string
): ExecutionEnvironment {
  if (!workspaceId) {
    throw new Error('Workflow execution logging requires workspaceId')
  }

  return {
    variables: {},
    workflowId,
    executionId,
    userId: userId || '',
    workspaceId,
  }
}

export async function loadWorkflowSummaryForExecution(workflowId: string) {
  const [row] = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      color: workflow.color,
      folderId: workflow.folderId,
      folderName: workflowFolder.name,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })
    .from(workflow)
    .leftJoin(workflowFolder, eq(workflow.folderId, workflowFolder.id))
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!row?.workspaceId) {
    throw new Error(`Workflow ${workflowId} is missing workspaceId`)
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    folderId: row.folderId,
    folderName: row.folderName,
    userId: row.userId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function calculateCostSummary(traceSpans: any[]) {
  type ModelTotal = {
    input?: number
    output?: number
    total?: number
    availableTotal?: number
    estimated?: boolean
    status: 'reported' | 'estimated' | 'unavailable' | 'partial'
    tokens: { prompt?: number; completion?: number; total?: number }
  }
  const models: Record<string, ModelTotal> = {}
  const seen = new Set<string>()
  let modelCost = 0
  let toolCost = 0
  let inputCost: number | undefined
  let outputCost: number | undefined
  let totalTokens: number | undefined
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let hasKnownCharge = false
  let unavailableComponents = 0
  let estimated = false
  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0

  const accumulate = (component: any, isTool = false) => {
    if (!component || typeof component !== 'object') return
    const original = component
    // Only server-created spans may carry typed inference; nested payloads need their own brand.
    const facts = getInferenceFacts(original) ?? (isTool ? undefined : original.inference)
    if (!facts) return
    component = {
      ...facts,
      ...(facts.cost || !(facts.model || facts.tokens || facts.nativePayload)
        ? {}
        : { cost: { status: 'unavailable' } }),
    }
    const fallbackId = isTool ? original.toolCallId : original.id
    const identity = fallbackId ? [fallbackId] : []
    if (identity.length > 0 && identity.every((id) => seen.has(id))) return
    identity.forEach((id) => seen.add(id))
    if (component.cost || component.tokens) {
      const cost = component.cost ?? {}
      const tokens = component.tokens ?? cost.tokens ?? {}
      const prompt = tokens.prompt ?? tokens.input
      const completion = tokens.completion ?? tokens.output
      const total = typeof tokens === 'number' ? tokens : tokens.total
      if (finite(prompt)) promptTokens = (promptTokens ?? 0) + prompt
      if (finite(completion)) completionTokens = (completionTokens ?? 0) + completion
      if (finite(total)) totalTokens = (totalTokens ?? 0) + total
      const available = finite(cost.total)
        ? cost.total
        : finite(cost.availableTotal)
          ? cost.availableTotal
          : undefined
      const known = finite(cost.total)
      const missing = !known || cost.status === 'partial' || cost.status === 'unavailable'
      const isEstimated = cost.status === 'estimated' || cost.estimated === true
      if (missing) unavailableComponents += 1
      estimated ||= isEstimated
      if (available !== undefined) {
        hasKnownCharge = true
        if (isTool) toolCost += available
        else modelCost += available
      }
      if (finite(cost.input)) inputCost = (inputCost ?? 0) + cost.input
      if (finite(cost.output)) outputCost = (outputCost ?? 0) + cost.output
      const modelName = component.model ?? cost.model
      if (modelName) {
        const model = (models[modelName] ??= {
          status: 'reported',
          tokens: {},
        })
        if (finite(cost.input)) model.input = (model.input ?? 0) + cost.input
        if (finite(cost.output)) model.output = (model.output ?? 0) + cost.output
        if (available !== undefined) model.availableTotal = (model.availableTotal ?? 0) + available
        if (known) model.total = (model.total ?? 0) + cost.total
        if (finite(prompt)) model.tokens.prompt = (model.tokens.prompt ?? 0) + prompt
        if (finite(completion))
          model.tokens.completion = (model.tokens.completion ?? 0) + completion
        if (finite(total)) model.tokens.total = (model.tokens.total ?? 0) + total
        model.estimated ||= isEstimated
        if (missing || model.status === 'partial' || model.status === 'unavailable')
          model.status = model.availableTotal === undefined ? 'unavailable' : 'partial'
        else if (model.estimated) model.status = 'estimated'
      }
    }
    if (Array.isArray(facts.toolResults) && facts.toolResults.length) {
      for (const result of facts.toolResults) accumulate(result, true)
    } else {
      // Charge-only tools still require trusted facts. Child lists already include their subtotal.
      if (finite(facts.toolCost)) {
        toolCost += facts.toolCost
        hasKnownCharge = true
      }
      unavailableComponents += facts.unavailableToolCosts ?? 0
    }
  }
  const visit = (spans: any[]) => {
    for (const span of spans ?? []) {
      // Child workflows settle their own usage. Their visible traces are inclusive.
      if (span.blockId && isWorkflowBlockType(span.type)) continue
      accumulate(span)
      if (Array.isArray(span.children)) visit(span.children)
    }
  }
  visit(traceSpans)
  for (const model of Object.values(models)) {
    if (model.status === 'partial' || model.status === 'unavailable') model.total = undefined
  }
  const availableTotal = modelCost + toolCost
  const status: ModelTotal['status'] = unavailableComponents
    ? hasKnownCharge
      ? 'partial'
      : 'unavailable'
    : estimated
      ? 'estimated'
      : 'reported'
  return {
    totalCost: unavailableComponents ? undefined : availableTotal,
    availableTotal: unavailableComponents && !hasKnownCharge ? undefined : availableTotal,
    totalInputCost: inputCost,
    totalOutputCost: outputCost,
    totalTokens,
    totalPromptTokens: promptTokens,
    totalCompletionTokens: completionTokens,
    modelCost: unavailableComponents && modelCost === 0 ? undefined : modelCost,
    status,
    unavailableComponents,
    estimated,
    toolCost,
    models,
  }
}
