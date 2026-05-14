import { db } from '@tradinggoose/db'
import {
  permissions,
  workflow,
  workflowExecutionLogs,
  workflowFolder,
  workspace,
} from '@tradinggoose/db/schema'
import { and, desc, eq, gte, inArray, lte, not, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowLogOutcome } from '@/lib/logs/types'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { generateRequestId, normalizeOptionalString } from '@/lib/utils'
import {
  parseListingFilters,
  serializeWorkflowLog,
  parseWorkflowLogFilterValues as splitCsv,
} from '@/app/api/logs/log-utils'

const logger = createLogger('LogsAPI')

export const revalidate = 0

const QueryParamsSchema = z.object({
  details: z.enum(['basic', 'full']).optional().default('basic'),
  limit: z.coerce.number().int().min(1).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  level: z.string().optional(),
  excludeLevel: z.string().optional(),
  outcomes: z.string().optional(),
  excludeOutcomes: z.string().optional(),
  workflowIds: z.string().optional(),
  excludeWorkflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  excludeTriggers: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  excludeWorkflowName: z.string().optional(),
  folderName: z.string().optional(),
  excludeFolderName: z.string().optional(),
  monitorId: z.string().optional(),
  excludeMonitorId: z.string().optional(),
  indicatorId: z.string().optional(),
  listings: z.string().optional(),
  excludeListings: z.string().optional(),
  providerId: z.string().optional(),
  excludeProviderId: z.string().optional(),
  interval: z.string().optional(),
  excludeInterval: z.string().optional(),
  assetType: z.string().optional(),
  assetTypes: z.string().optional(),
  excludeAssetTypes: z.string().optional(),
  hasFields: z.string().optional(),
  noFields: z.string().optional(),
  startedAtFrom: z.string().optional(),
  startedAtFromExclusive: z.string().optional(),
  startedAtTo: z.string().optional(),
  startedAtToExclusive: z.string().optional(),
  endedAtFrom: z.string().optional(),
  endedAtFromExclusive: z.string().optional(),
  endedAtTo: z.string().optional(),
  endedAtToExclusive: z.string().optional(),
  durationMinMs: z.coerce.number().optional(),
  durationMinMsExclusive: z.string().optional(),
  durationMaxMs: z.coerce.number().optional(),
  durationMaxMsExclusive: z.string().optional(),
  costMin: z.coerce.number().optional(),
  costMinExclusive: z.string().optional(),
  costMax: z.coerce.number().optional(),
  costMaxExclusive: z.string().optional(),
  triggerSource: z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }, z.literal('indicator_trigger').optional()),
  workspaceId: z.string(),
})

const parseBooleanFlag = (value: string | undefined) => value === 'true' || value === '1'

const TOTAL_COST_SQL = sql<number>`COALESCE((${workflowExecutionLogs.cost}->>'total')::double precision, 0)`
const WORKFLOW_NAME_SQL = sql<string>`COALESCE(${workflow.name}, ${workflowExecutionLogs.workflowSummary}->>'name', 'Deleted workflow')`
const WORKFLOW_FOLDER_ID_SQL = sql<string>`COALESCE(${workflow.folderId}, ${workflowExecutionLogs.workflowSummary}->>'folderId')`
const WORKFLOW_FOLDER_NAME_SQL = sql<string>`COALESCE(${workflowFolder.name}, ${workflowExecutionLogs.workflowSummary}->>'folderName')`
const MONITOR_SQL = sql`${workflowExecutionLogs.executionData}->'trigger'->'data'->'monitor'`
const MONITOR_ID_SQL = sql<string>`${MONITOR_SQL}->>'id'`
const MONITOR_PROVIDER_ID_SQL = sql<string>`${MONITOR_SQL}->>'providerId'`
const MONITOR_INTERVAL_SQL = sql<string>`${MONITOR_SQL}->>'interval'`
const MONITOR_INDICATOR_ID_SQL = sql<string>`${MONITOR_SQL}->>'indicatorId'`
const MONITOR_LISTING_SQL = sql`${MONITOR_SQL}->'listing'`
const MONITOR_LISTING_TYPE_SQL = sql<string>`${MONITOR_LISTING_SQL}->>'listing_type'`
const MONITOR_LISTING_ID_SQL = sql<string>`${MONITOR_LISTING_SQL}->>'listing_id'`
const MONITOR_LISTING_BASE_ID_SQL = sql<string>`${MONITOR_LISTING_SQL}->>'base_id'`
const MONITOR_LISTING_QUOTE_ID_SQL = sql<string>`${MONITOR_LISTING_SQL}->>'quote_id'`
const MONITOR_ASSET_TYPE_SQL = sql<string>`LOWER(COALESCE(NULLIF(${MONITOR_LISTING_SQL}->>'assetClass', ''), NULLIF(${MONITOR_LISTING_SQL}->>'base_asset_class', ''), NULLIF(${MONITOR_LISTING_TYPE_SQL}, ''), 'unknown'))`
const BLOCK_EXECUTIONS_SQL = sql`CASE WHEN jsonb_typeof(${workflowExecutionLogs.executionData}->'blockExecutions') = 'array' THEN ${workflowExecutionLogs.executionData}->'blockExecutions' ELSE '[]'::jsonb END`
const TRACE_SPAN_ROOTS_SQL = sql`CASE
  WHEN jsonb_typeof(${workflowExecutionLogs.executionData}->'traceSpans') = 'array'
    THEN ${workflowExecutionLogs.executionData}->'traceSpans'
  ELSE '[]'::jsonb
END`
const traceSpanStatusExists = (statusPredicate: SQL = sql``) => sql<boolean>`EXISTS (
  WITH RECURSIVE trace_spans(span) AS (
    SELECT trace_span.value
    FROM jsonb_array_elements(${TRACE_SPAN_ROOTS_SQL}) AS trace_span(value)
    UNION ALL
    SELECT child_trace_span.value
    FROM trace_spans
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(trace_spans.span->'children') = 'array'
          THEN trace_spans.span->'children'
        ELSE '[]'::jsonb
      END
    ) AS child_trace_span(value)
  )
  SELECT 1
  FROM trace_spans
  WHERE jsonb_typeof(trace_spans.span->'status') = 'string'
  ${statusPredicate}
)`
const TRACE_STATUS_EXISTS_SQL = traceSpanStatusExists()
const TRACE_ERROR_EXISTS_SQL = traceSpanStatusExists(sql`AND trace_spans.span->>'status' = 'error'`)
const TRACE_NON_SKIPPED_EXISTS_SQL = traceSpanStatusExists(
  sql`AND trace_spans.span->>'status' <> 'skipped'`
)
const BLOCK_STATUS_EXISTS_SQL = sql<boolean>`EXISTS (
  SELECT 1 FROM jsonb_array_elements(${BLOCK_EXECUTIONS_SQL}) AS block_execution(value)
  WHERE jsonb_typeof(block_execution.value->'status') = 'string'
)`
const BLOCK_ERROR_EXISTS_SQL = sql<boolean>`EXISTS (
  SELECT 1 FROM jsonb_array_elements(${BLOCK_EXECUTIONS_SQL}) AS block_execution(value)
  WHERE jsonb_typeof(block_execution.value->'status') = 'string'
    AND block_execution.value->>'status' = 'error'
)`
const BLOCK_NON_SKIPPED_EXISTS_SQL = sql<boolean>`EXISTS (
  SELECT 1 FROM jsonb_array_elements(${BLOCK_EXECUTIONS_SQL}) AS block_execution(value)
  WHERE jsonb_typeof(block_execution.value->'status') = 'string'
    AND block_execution.value->>'status' <> 'skipped'
)`
const WORKFLOW_LOG_OUTCOME_SQL = sql<WorkflowLogOutcome>`CASE
  WHEN ${workflowExecutionLogs.endedAt} IS NULL THEN 'running'
  WHEN ${TRACE_ERROR_EXISTS_SQL} THEN 'error'
  WHEN ${TRACE_STATUS_EXISTS_SQL} AND NOT ${TRACE_NON_SKIPPED_EXISTS_SQL} THEN 'skipped'
  WHEN ${TRACE_STATUS_EXISTS_SQL} THEN 'success'
  WHEN ${BLOCK_ERROR_EXISTS_SQL} THEN 'error'
  WHEN ${BLOCK_STATUS_EXISTS_SQL} AND NOT ${BLOCK_NON_SKIPPED_EXISTS_SQL} THEN 'skipped'
  WHEN ${BLOCK_STATUS_EXISTS_SQL} THEN 'success'
  WHEN ${workflowExecutionLogs.level} = 'error' THEN 'error'
  ELSE 'unknown'
END`

const LOG_SELECT_FIELDS = {
  id: workflowExecutionLogs.id,
  workflowId: workflowExecutionLogs.workflowId,
  workspaceId: workflowExecutionLogs.workspaceId,
  executionId: workflowExecutionLogs.executionId,
  workflowSummary: workflowExecutionLogs.workflowSummary,
  level: workflowExecutionLogs.level,
  trigger: workflowExecutionLogs.trigger,
  startedAt: workflowExecutionLogs.startedAt,
  endedAt: workflowExecutionLogs.endedAt,
  totalDurationMs: workflowExecutionLogs.totalDurationMs,
  cost: workflowExecutionLogs.cost,
  createdAt: workflowExecutionLogs.createdAt,
  workflowName: workflow.name,
  workflowDescription: workflow.description,
  workflowColor: workflow.color,
  workflowFolderId: workflow.folderId,
  workflowFolderName: workflowFolder.name,
  workflowUserId: workflow.userId,
  workflowWorkspaceId: workflow.workspaceId,
  workflowCreatedAt: workflow.createdAt,
  workflowUpdatedAt: workflow.updatedAt,
}

const LOG_BASIC_SELECT_FIELDS = {
  ...LOG_SELECT_FIELDS,
  outcome: WORKFLOW_LOG_OUTCOME_SQL,
}

const LOG_FULL_SELECT_FIELDS = {
  ...LOG_SELECT_FIELDS,
  executionData: workflowExecutionLogs.executionData,
  files: workflowExecutionLogs.files,
}

const LOG_ORDER_BY = [
  desc(workflowExecutionLogs.startedAt),
  desc(workflowExecutionLogs.createdAt),
  desc(workflowExecutionLogs.id),
]

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

const containsText = (expression: any, value: string) =>
  sql`${expression} ILIKE ${`%${escapeLikePattern(value)}%`} ESCAPE '\\'`

const notContainsText = (expression: any, value: string) =>
  sql`(${expression} IS NULL OR ${expression} NOT ILIKE ${`%${escapeLikePattern(value)}%`} ESCAPE '\\')`

const applyTextInclude = (conditions: SQL | undefined, expression: any, values: string[]) => {
  if (values.length === 0) return conditions
  return and(conditions, or(...values.map((value) => containsText(expression, value))))
}

const applyTextExclude = (conditions: SQL | undefined, expression: any, values: string[]) => {
  if (values.length === 0) return conditions
  return and(conditions, ...values.map((value) => notContainsText(expression, value)))
}

const applyStringInclude = (conditions: SQL | undefined, expression: any, values: string[]) => {
  if (values.length === 0) return conditions
  return and(conditions, inArray(expression, values))
}

const applyStringExclude = (conditions: SQL | undefined, expression: any, values: string[]) => {
  if (values.length === 0) return conditions
  return and(conditions, or(sql`${expression} IS NULL`, notInArray(expression, values)))
}

const applyValueFilters = (
  conditions: SQL | undefined,
  filters: Array<[any, string[]]>,
  applyFilter: (conditions: SQL | undefined, expression: any, values: string[]) => SQL | undefined
) =>
  filters.reduce((next, [expression, values]) => applyFilter(next, expression, values), conditions)

const toListingCondition = (
  listing: NonNullable<ReturnType<typeof parseListingFilters>>[number]
) =>
  listing.listing_type === 'default'
    ? and(
        eq(MONITOR_LISTING_TYPE_SQL, listing.listing_type),
        eq(MONITOR_LISTING_ID_SQL, listing.listing_id)
      )
    : and(
        eq(MONITOR_LISTING_TYPE_SQL, listing.listing_type),
        eq(MONITOR_LISTING_BASE_ID_SQL, listing.base_id),
        eq(MONITOR_LISTING_QUOTE_ID_SQL, listing.quote_id)
      )

const applyListingInclude = (
  conditions: SQL | undefined,
  listings: NonNullable<ReturnType<typeof parseListingFilters>>
) => {
  if (listings.length === 0) return conditions
  return and(conditions, or(...listings.map(toListingCondition)))
}

const applyListingExclude = (
  conditions: SQL | undefined,
  listings: NonNullable<ReturnType<typeof parseListingFilters>>
) => {
  if (listings.length === 0) return conditions
  const condition = or(...listings.map(toListingCondition))
  return condition ? and(conditions, sql`COALESCE(NOT (${condition}), true)`) : conditions
}

const FIELD_PRESENCE_CONDITIONS: Record<string, SQL> = {
  monitor: sql`NULLIF(${MONITOR_ID_SQL}, '') IS NOT NULL`,
  listing: sql`COALESCE(jsonb_typeof(${MONITOR_LISTING_SQL}) = 'object', false)`,
  indicator: sql`NULLIF(${MONITOR_INDICATOR_ID_SQL}, '') IS NOT NULL`,
  provider: sql`NULLIF(${MONITOR_PROVIDER_ID_SQL}, '') IS NOT NULL`,
  interval: sql`NULLIF(${MONITOR_INTERVAL_SQL}, '') IS NOT NULL`,
  endedAt: sql`${workflowExecutionLogs.endedAt} IS NOT NULL`,
  cost: sql`COALESCE(jsonb_typeof(${workflowExecutionLogs.cost}->'total') = 'number', false)`,
}

const applyFieldPresenceFilters = (
  conditions: SQL | undefined,
  hasFields: string[],
  noFields: string[]
) => {
  const requiredFields = hasFields
    .map((field) => FIELD_PRESENCE_CONDITIONS[field])
    .filter((condition): condition is SQL => Boolean(condition))
  const missingFields = noFields
    .map((field) => FIELD_PRESENCE_CONDITIONS[field])
    .filter((condition): condition is SQL => Boolean(condition))
    .map((condition) => not(condition))

  return and(conditions, ...requiredFields, ...missingFields)
}

const applyDateLowerBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.startedAt | typeof workflowExecutionLogs.endedAt,
  value: string | undefined,
  exclusive: boolean
) => {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return conditions

  const bound = new Date(normalized)
  return and(conditions, exclusive ? sql`${column} > ${bound}` : gte(column, bound))
}

const applyDateUpperBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.startedAt | typeof workflowExecutionLogs.endedAt,
  value: string | undefined,
  exclusive: boolean
) => {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return conditions

  const bound = new Date(normalized)
  return and(conditions, exclusive ? sql`${column} < ${bound}` : lte(column, bound))
}

const applyNumberLowerBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.totalDurationMs,
  value: number | undefined,
  exclusive: boolean
) => {
  if (typeof value !== 'number') return conditions
  return and(conditions, exclusive ? sql`${column} > ${value}` : gte(column, value))
}

const applyNumberUpperBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.totalDurationMs,
  value: number | undefined,
  exclusive: boolean
) => {
  if (typeof value !== 'number') return conditions
  return and(conditions, exclusive ? sql`${column} < ${value}` : lte(column, value))
}

const applyCostLowerBound = (
  conditions: SQL | undefined,
  value: number | undefined,
  exclusive: boolean
) => {
  if (typeof value !== 'number') return conditions
  return and(
    conditions,
    exclusive ? sql`${TOTAL_COST_SQL} > ${value}` : sql`${TOTAL_COST_SQL} >= ${value}`
  )
}

const applyCostUpperBound = (
  conditions: SQL | undefined,
  value: number | undefined,
  exclusive: boolean
) => {
  if (typeof value !== 'number') return conditions
  return and(
    conditions,
    exclusive ? sql`${TOTAL_COST_SQL} < ${value}` : sql`${TOTAL_COST_SQL} <= ${value}`
  )
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const validationResult = QueryParamsSchema.safeParse(Object.fromEntries(searchParams.entries()))
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }
    const params = validationResult.data

    const listings = parseListingFilters(params.listings)
    const excludedListings = parseListingFilters(params.excludeListings)

    if (listings === null || excludedListings === null) {
      return NextResponse.json({ error: 'Invalid listing filter' }, { status: 400 })
    }

    let conditions: SQL | undefined

    if (params.workflowIds) {
      const workflowIds = splitCsv(params.workflowIds)
      if (workflowIds.length > 0) {
        conditions = and(
          conditions,
          or(
            inArray(workflowExecutionLogs.workflowId, workflowIds),
            inArray(sql<string>`${workflowExecutionLogs.workflowSummary}->>'id'`, workflowIds)
          )
        )
      }
    }

    if (params.folderIds) {
      const folderIds = splitCsv(params.folderIds)
      if (folderIds.length > 0) {
        conditions = and(conditions, inArray(WORKFLOW_FOLDER_ID_SQL, folderIds))
      }
    }

    if (params.triggers) {
      const triggers = splitCsv(params.triggers)
      if (triggers.length > 0) {
        conditions = and(conditions, inArray(workflowExecutionLogs.trigger, triggers))
      }
    }

    if (params.startDate) {
      conditions = and(conditions, gte(workflowExecutionLogs.startedAt, new Date(params.startDate)))
    }

    if (params.endDate) {
      conditions = and(conditions, lte(workflowExecutionLogs.startedAt, new Date(params.endDate)))
    }

    for (const [column, value, exclusive, upper] of [
      [workflowExecutionLogs.startedAt, params.startedAtFrom, params.startedAtFromExclusive, false],
      [workflowExecutionLogs.startedAt, params.startedAtTo, params.startedAtToExclusive, true],
      [workflowExecutionLogs.endedAt, params.endedAtFrom, params.endedAtFromExclusive, false],
      [workflowExecutionLogs.endedAt, params.endedAtTo, params.endedAtToExclusive, true],
    ] as const) {
      conditions = upper
        ? applyDateUpperBound(conditions, column, value, parseBooleanFlag(exclusive))
        : applyDateLowerBound(conditions, column, value, parseBooleanFlag(exclusive))
    }

    for (const [value, exclusive, upper] of [
      [params.durationMinMs, params.durationMinMsExclusive, false],
      [params.durationMaxMs, params.durationMaxMsExclusive, true],
    ] as const) {
      conditions = upper
        ? applyNumberUpperBound(
            conditions,
            workflowExecutionLogs.totalDurationMs,
            value,
            parseBooleanFlag(exclusive)
          )
        : applyNumberLowerBound(
            conditions,
            workflowExecutionLogs.totalDurationMs,
            value,
            parseBooleanFlag(exclusive)
          )
    }

    for (const [value, exclusive, upper] of [
      [params.costMin, params.costMinExclusive, false],
      [params.costMax, params.costMaxExclusive, true],
    ] as const) {
      conditions = upper
        ? applyCostUpperBound(conditions, value, parseBooleanFlag(exclusive))
        : applyCostLowerBound(conditions, value, parseBooleanFlag(exclusive))
    }

    if (params.triggerSource) {
      conditions = and(
        conditions,
        sql`${workflowExecutionLogs.executionData}->'trigger'->>'source' = ${params.triggerSource}`
      )
    }

    conditions = applyValueFilters(
      conditions,
      [
        [workflowExecutionLogs.level, splitCsv(params.level)],
        [WORKFLOW_LOG_OUTCOME_SQL, splitCsv(params.outcomes)],
        [MONITOR_ID_SQL, splitCsv(params.monitorId)],
        [MONITOR_INDICATOR_ID_SQL, splitCsv(params.indicatorId)],
        [MONITOR_PROVIDER_ID_SQL, splitCsv(params.providerId)],
        [MONITOR_INTERVAL_SQL, splitCsv(params.interval)],
      ],
      applyStringInclude
    )
    conditions = applyValueFilters(
      conditions,
      [
        [workflowExecutionLogs.level, splitCsv(params.excludeLevel)],
        [WORKFLOW_LOG_OUTCOME_SQL, splitCsv(params.excludeOutcomes)],
        [workflowExecutionLogs.trigger, splitCsv(params.excludeTriggers)],
        [
          sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, ${workflowExecutionLogs.workflowSummary}->>'id')`,
          splitCsv(params.excludeWorkflowIds),
        ],
        [MONITOR_ID_SQL, splitCsv(params.excludeMonitorId)],
        [MONITOR_PROVIDER_ID_SQL, splitCsv(params.excludeProviderId)],
        [MONITOR_INTERVAL_SQL, splitCsv(params.excludeInterval)],
      ],
      applyStringExclude
    )
    conditions = applyValueFilters(
      conditions,
      [
        [WORKFLOW_NAME_SQL, splitCsv(params.workflowName)],
        [WORKFLOW_FOLDER_NAME_SQL, splitCsv(params.folderName)],
      ],
      applyTextInclude
    )
    conditions = applyValueFilters(
      conditions,
      [
        [WORKFLOW_NAME_SQL, splitCsv(params.excludeWorkflowName)],
        [WORKFLOW_FOLDER_NAME_SQL, splitCsv(params.excludeFolderName)],
      ],
      applyTextExclude
    )
    conditions = applyListingInclude(conditions, listings ?? [])
    conditions = applyListingExclude(conditions, excludedListings ?? [])
    conditions = applyStringInclude(
      conditions,
      MONITOR_ASSET_TYPE_SQL,
      [...splitCsv(params.assetTypes), ...splitCsv(params.assetType)].map((entry) =>
        entry.toLowerCase()
      )
    )
    conditions = applyStringExclude(
      conditions,
      MONITOR_ASSET_TYPE_SQL,
      splitCsv(params.excludeAssetTypes).map((entry) => entry.toLowerCase())
    )
    conditions = applyFieldPresenceFilters(
      conditions,
      splitCsv(params.hasFields),
      splitCsv(params.noFields)
    )

    const search = normalizeOptionalString(params.search)
    if (search) {
      conditions = and(
        conditions,
        or(
          containsText(workflowExecutionLogs.executionId, search),
          containsText(WORKFLOW_NAME_SQL, search),
          containsText(MONITOR_ID_SQL, search),
          containsText(MONITOR_INDICATOR_ID_SQL, search),
          containsText(MONITOR_PROVIDER_ID_SQL, search),
          containsText(MONITOR_INTERVAL_SQL, search),
          containsText(MONITOR_LISTING_ID_SQL, search),
          containsText(MONITOR_LISTING_BASE_ID_SQL, search),
          containsText(MONITOR_LISTING_QUOTE_ID_SQL, search)
        )
      )
    }

    const scopedConditions = and(
      eq(workflowExecutionLogs.workspaceId, params.workspaceId),
      conditions
    )
    const workspaceAccess = buildWorkspaceAccessScope(userId, workflowExecutionLogs.workspaceId)
    const countRows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .leftJoin(workflowFolder, eq(workflow.folderId, workflowFolder.id))
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(and(scopedConditions, workspaceAccess.accessFilter))

    const rows = await db
      .select(params.details === 'full' ? LOG_FULL_SELECT_FIELDS : LOG_BASIC_SELECT_FIELDS)
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .leftJoin(workflowFolder, eq(workflow.folderId, workflowFolder.id))
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(and(scopedConditions, workspaceAccess.accessFilter))
      .orderBy(...LOG_ORDER_BY)
      .limit(params.limit)
      .offset(params.offset)

    const total = Number(countRows[0]?.total ?? 0)

    return NextResponse.json({
      data: rows.map((row) => serializeWorkflowLog(row, params.details)),
      total,
      page: Math.floor(params.offset / params.limit) + 1,
      pageSize: params.limit,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    })
  } catch (error: any) {
    logger.error(`[${requestId}] logs fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
