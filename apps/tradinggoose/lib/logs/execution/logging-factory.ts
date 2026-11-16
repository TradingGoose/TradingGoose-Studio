import { db } from '@tradinggoose/db'
import { workflow, workflowFolder } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { ExecutionEnvironment, ExecutionTrigger } from '@/lib/logs/types'
import type { InferenceFacts } from '@/lib/mastra/result'
import { resultAccounting, sumNativeCosts, sumNativeUsage } from '@/lib/mastra/usage'

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

export function calculateCostSummary(usage: readonly InferenceFacts[]) {
  const components: InferenceFacts[] = []
  const modelComponents = new Map<string, InferenceFacts[]>()
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
    const cost = sumNativeCosts(
      facts.length ? facts.map((component) => component.cost!) : [{ total: 0, status: 'reported' }]
    )
    return {
      ...cost,
      availableTotal: cost.total ?? cost.availableTotal,
      tokens: resultAccounting(usage).tokens,
    }
  }
  for (const facts of usage) {
    if (facts.cost || facts.tokens || facts.model) {
      const reference = sumNativeCosts([facts.cost ?? { status: 'unavailable' }])
      // BYOK estimates remain on the span; workflow settlement prices account-funded usage.
      const cost = reference.accountCost ?? reference
      const component = { ...facts, cost }
      components.push(component)
      if (cost.status === 'partial' || cost.status === 'unavailable') unavailableComponents += 1
      if (facts.model) {
        const group = modelComponents.get(facts.model) ?? []
        group.push(component)
        modelComponents.set(facts.model, group)
      }
    }
  }

  const model = summarize(components)
  return {
    totalCost: model.total,
    availableTotal: model.availableTotal,
    totalInputCost: model.input,
    totalOutputCost: model.output,
    totalTokens: model.tokens.total,
    totalPromptTokens: model.tokens.prompt,
    totalCompletionTokens: model.tokens.completion,
    modelCost: model.total ?? model.availableTotal,
    status: model.status,
    unavailableComponents,
    estimated: model.estimated === true,
    models: Object.fromEntries(
      [...modelComponents].map(([name, facts]) => [name, summarize(facts)])
    ),
  }
}
