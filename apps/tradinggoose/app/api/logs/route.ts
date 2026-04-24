import { db } from "@tradinggoose/db";
import {
  permissions,
  workflow,
  workflowExecutionLogs,
  workflowFolder,
} from "@tradinggoose/db/schema";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createLogger } from "@/lib/logs/console/logger";
import { generateRequestId, normalizeOptionalString } from "@/lib/utils";
import {
  matchesWorkflowLogFilters,
  parseListingFilters,
  serializeWorkflowLog,
  toPaginatedLogsResponse,
} from "@/app/api/logs/log-utils";

const logger = createLogger("LogsAPI");

export const revalidate = 0;

const QueryParamsSchema = z.object({
  details: z.enum(["basic", "full"]).optional().default("basic"),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
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
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.literal("indicator_trigger").optional()),
  workspaceId: z.string(),
});

const splitCsv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseBooleanFlag = (value: string | undefined) =>
  value === "true" || value === "1";

const TOTAL_COST_SQL = sql<number>`COALESCE((${workflowExecutionLogs.cost}->>'total')::double precision, 0)`;

const applyDateLowerBound = (
  conditions: SQL | undefined,
  column:
    | typeof workflowExecutionLogs.startedAt
    | typeof workflowExecutionLogs.endedAt,
  value: string | undefined,
  exclusive: boolean,
) => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return conditions;

  const bound = new Date(normalized);
  return and(
    conditions,
    exclusive ? sql`${column} > ${bound}` : gte(column, bound),
  );
};

const applyDateUpperBound = (
  conditions: SQL | undefined,
  column:
    | typeof workflowExecutionLogs.startedAt
    | typeof workflowExecutionLogs.endedAt,
  value: string | undefined,
  exclusive: boolean,
) => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return conditions;

  const bound = new Date(normalized);
  return and(
    conditions,
    exclusive ? sql`${column} < ${bound}` : lte(column, bound),
  );
};

const applyNumberLowerBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.totalDurationMs,
  value: number | undefined,
  exclusive: boolean,
) => {
  if (typeof value !== "number") return conditions;
  return and(
    conditions,
    exclusive ? sql`${column} > ${value}` : gte(column, value),
  );
};

const applyNumberUpperBound = (
  conditions: SQL | undefined,
  column: typeof workflowExecutionLogs.totalDurationMs,
  value: number | undefined,
  exclusive: boolean,
) => {
  if (typeof value !== "number") return conditions;
  return and(
    conditions,
    exclusive ? sql`${column} < ${value}` : lte(column, value),
  );
};

const applyCostLowerBound = (
  conditions: SQL | undefined,
  value: number | undefined,
  exclusive: boolean,
) => {
  if (typeof value !== "number") return conditions;
  return and(
    conditions,
    exclusive
      ? sql`${TOTAL_COST_SQL} > ${value}`
      : sql`${TOTAL_COST_SQL} >= ${value}`,
  );
};

const applyCostUpperBound = (
  conditions: SQL | undefined,
  value: number | undefined,
  exclusive: boolean,
) => {
  if (typeof value !== "number") return conditions;
  return and(
    conditions,
    exclusive
      ? sql`${TOTAL_COST_SQL} < ${value}`
      : sql`${TOTAL_COST_SQL} <= ${value}`,
  );
};

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    const session = await getSession();
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs access attempt`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const params = QueryParamsSchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const listings = parseListingFilters(params.listings);
    const excludedListings = parseListingFilters(params.excludeListings);

    if (listings === null || excludedListings === null) {
      return NextResponse.json(
        { error: "Invalid listing filter" },
        { status: 400 },
      );
    }

    let conditions: SQL | undefined;

    if (params.workflowIds) {
      const workflowIds = splitCsv(params.workflowIds);
      if (workflowIds.length > 0) {
        conditions = and(conditions, inArray(workflow.id, workflowIds));
      }
    }

    if (params.folderIds) {
      const folderIds = splitCsv(params.folderIds);
      if (folderIds.length > 0) {
        conditions = and(conditions, inArray(workflow.folderId, folderIds));
      }
    }

    if (params.triggers) {
      const triggers = splitCsv(params.triggers);
      if (triggers.length > 0 && !triggers.includes("all")) {
        conditions = and(
          conditions,
          inArray(workflowExecutionLogs.trigger, triggers),
        );
      }
    }

    if (params.startDate) {
      conditions = and(
        conditions,
        gte(workflowExecutionLogs.startedAt, new Date(params.startDate)),
      );
    }

    if (params.endDate) {
      conditions = and(
        conditions,
        lte(workflowExecutionLogs.startedAt, new Date(params.endDate)),
      );
    }

    conditions = applyDateLowerBound(
      conditions,
      workflowExecutionLogs.startedAt,
      params.startedAtFrom,
      parseBooleanFlag(params.startedAtFromExclusive),
    );
    conditions = applyDateUpperBound(
      conditions,
      workflowExecutionLogs.startedAt,
      params.startedAtTo,
      parseBooleanFlag(params.startedAtToExclusive),
    );
    conditions = applyDateLowerBound(
      conditions,
      workflowExecutionLogs.endedAt,
      params.endedAtFrom,
      parseBooleanFlag(params.endedAtFromExclusive),
    );
    conditions = applyDateUpperBound(
      conditions,
      workflowExecutionLogs.endedAt,
      params.endedAtTo,
      parseBooleanFlag(params.endedAtToExclusive),
    );
    conditions = applyNumberLowerBound(
      conditions,
      workflowExecutionLogs.totalDurationMs,
      params.durationMinMs,
      parseBooleanFlag(params.durationMinMsExclusive),
    );
    conditions = applyNumberUpperBound(
      conditions,
      workflowExecutionLogs.totalDurationMs,
      params.durationMaxMs,
      parseBooleanFlag(params.durationMaxMsExclusive),
    );
    conditions = applyCostLowerBound(
      conditions,
      params.costMin,
      parseBooleanFlag(params.costMinExclusive),
    );
    conditions = applyCostUpperBound(
      conditions,
      params.costMax,
      parseBooleanFlag(params.costMaxExclusive),
    );

    if (params.triggerSource) {
      conditions = and(
        conditions,
        sql`${workflowExecutionLogs.executionData}->'trigger'->>'source' = ${params.triggerSource}`,
      );
    }

    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
        files: workflowExecutionLogs.files,
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
      })
      .from(workflow)
      .innerJoin(
        workflowExecutionLogs,
        eq(workflowExecutionLogs.workflowId, workflow.id),
      )
      .leftJoin(workflowFolder, eq(workflow.folderId, workflowFolder.id))
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, "workspace"),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId),
        ),
      )
      .where(and(eq(workflow.workspaceId, params.workspaceId), conditions))
      .orderBy(desc(workflowExecutionLogs.startedAt));

    const filters = {
      search: normalizeOptionalString(params.search) ?? undefined,
      level: splitCsv(params.level),
      excludeLevel: splitCsv(params.excludeLevel),
      outcomes: splitCsv(params.outcomes),
      excludeOutcomes: splitCsv(params.excludeOutcomes),
      triggers: splitCsv(params.triggers),
      excludeTriggers: splitCsv(params.excludeTriggers),
      workflowIds: splitCsv(params.workflowIds),
      excludeWorkflowIds: splitCsv(params.excludeWorkflowIds),
      workflowNames: splitCsv(params.workflowName),
      excludeWorkflowNames: splitCsv(params.excludeWorkflowName),
      folderNames: splitCsv(params.folderName),
      excludeFolderNames: splitCsv(params.excludeFolderName),
      monitorId: splitCsv(params.monitorId),
      excludeMonitorId: splitCsv(params.excludeMonitorId),
      indicatorId: splitCsv(params.indicatorId),
      providerId: splitCsv(params.providerId),
      excludeProviderId: splitCsv(params.excludeProviderId),
      interval: splitCsv(params.interval),
      excludeInterval: splitCsv(params.excludeInterval),
      listings: listings ?? [],
      excludeListings: excludedListings ?? [],
      assetTypes: splitCsv(params.assetTypes).map((entry) =>
        entry.toLowerCase(),
      ),
      excludeAssetTypes: splitCsv(params.excludeAssetTypes).map((entry) =>
        entry.toLowerCase(),
      ),
      hasFields: splitCsv(params.hasFields),
      noFields: splitCsv(params.noFields),
      startedAtFrom: normalizeOptionalString(params.startedAtFrom) ?? undefined,
      startedAtFromExclusive: parseBooleanFlag(params.startedAtFromExclusive),
      startedAtTo: normalizeOptionalString(params.startedAtTo) ?? undefined,
      startedAtToExclusive: parseBooleanFlag(params.startedAtToExclusive),
      endedAtFrom: normalizeOptionalString(params.endedAtFrom) ?? undefined,
      endedAtFromExclusive: parseBooleanFlag(params.endedAtFromExclusive),
      endedAtTo: normalizeOptionalString(params.endedAtTo) ?? undefined,
      endedAtToExclusive: parseBooleanFlag(params.endedAtToExclusive),
      durationMinMs: params.durationMinMs,
      durationMinMsExclusive: parseBooleanFlag(params.durationMinMsExclusive),
      durationMaxMs: params.durationMaxMs,
      durationMaxMsExclusive: parseBooleanFlag(params.durationMaxMsExclusive),
      costMin: params.costMin,
      costMinExclusive: parseBooleanFlag(params.costMinExclusive),
      costMax: params.costMax,
      costMaxExclusive: parseBooleanFlag(params.costMaxExclusive),
    };

    const filteredLogs = rows.flatMap((row) => {
      const fullLog = serializeWorkflowLog(row, "full");
      if (!matchesWorkflowLogFilters(fullLog, filters)) {
        return [];
      }

      if (params.details === "full") {
        return [fullLog];
      }

      return [serializeWorkflowLog(row, params.details)];
    });

    return NextResponse.json(
      toPaginatedLogsResponse(filteredLogs, params.limit, params.offset),
    );
  } catch (error: any) {
    logger.error(`[${requestId}] logs fetch error`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
