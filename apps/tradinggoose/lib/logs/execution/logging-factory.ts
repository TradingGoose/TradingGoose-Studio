import { db } from '@tradinggoose/db'
import { workflow, workflowFolder } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { ExecutionEnvironment, ExecutionTrigger } from '@/lib/logs/types'
import { getInferenceFacts, type InferenceFacts } from '@/lib/mastra/result'
import {
  type NativeCost,
  resultAccounting,
  sumNativeCosts,
  sumNativeUsage,
} from '@/lib/mastra/usage'
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
  const components: InferenceFacts[] = []
  const modelComponents = new Map<string, InferenceFacts[]>()
  const toolCharges: NativeCost[] = []
  const seen = new Set<string>()
  let toolCost = 0
  let unavailableComponents = 0
  const summarize = (facts: InferenceFacts[]) => {
    const usage = sumNativeUsage(
      facts.map(({ tokens }) => ({
        usage: {
          inputTokens: tokens?.prompt,
          outputTokens: tokens?.completion,
          totalTokens: tokens?.total,
        },
      }))
    )
    const cost = sumNativeCosts(facts.map((component) => component.cost!))
    return {
      ...cost,
      availableTotal: cost.total ?? cost.availableTotal,
      tokens: resultAccounting(usage).tokens,
    }
  }
  const accumulate = (facts: InferenceFacts | undefined, id?: string) => {
    if (!facts || (id && seen.has(id))) return
    if (id) seen.add(id)
    if (facts.cost || facts.tokens || facts.model) {
      const cost = sumNativeCosts([facts.cost ?? { status: 'unavailable' }])
      const component = { ...facts, cost }
      components.push(component)
      if (cost.status === 'partial' || cost.status === 'unavailable') unavailableComponents += 1
      if (facts.model) {
        const group = modelComponents.get(facts.model) ?? []
        group.push(component)
        modelComponents.set(facts.model, group)
      }
    }
    if (facts.toolResults?.length) {
      for (const result of facts.toolResults) accumulate(result.inference, result.toolCallId)
    } else {
      // Child lists already contain their subtotal; only charge-only tools add one here.
      if (
        typeof facts.toolCost === 'number' &&
        Number.isFinite(facts.toolCost) &&
        facts.toolCost >= 0
      ) {
        toolCost += facts.toolCost
        toolCharges.push({ total: facts.toolCost, status: 'reported' })
      }
      if (facts.unavailableToolCosts) {
        unavailableComponents += facts.unavailableToolCosts
        toolCharges.push({ status: 'unavailable' })
      }
    }
  }
  const visit = (spans: any[]) => {
    for (const span of spans ?? []) {
      // Child workflows settle their own usage. Their visible traces are inclusive.
      if (span.blockId && isWorkflowBlockType(span.type)) continue
      accumulate(getInferenceFacts(span) ?? span.inference, span.id)
      if (Array.isArray(span.children)) visit(span.children)
    }
  }
  visit(traceSpans)
  const model = summarize(components)
  const costs = [...components.map((component) => component.cost!), ...toolCharges]
  const cost = sumNativeCosts(costs.length ? costs : [{ total: 0, status: 'reported' }])
  return {
    totalCost: cost.total,
    availableTotal: cost.total ?? cost.availableTotal,
    totalInputCost: model.input,
    totalOutputCost: model.output,
    totalTokens: model.tokens.total,
    totalPromptTokens: model.tokens.prompt,
    totalCompletionTokens: model.tokens.completion,
    modelCost: model.total ?? model.availableTotal ?? (unavailableComponents ? undefined : 0),
    status: cost.status,
    unavailableComponents,
    estimated: cost.estimated === true,
    toolCost,
    models: Object.fromEntries(
      [...modelComponents].map(([name, facts]) => [name, summarize(facts)])
    ),
  }
}
