import {
  type ListingIdentity,
  toListingValueObject,
} from "@/lib/listing/identity";
import type {
  LogsResponse,
  TraceSpan,
  WorkflowLog,
  WorkflowLogOutcome,
} from "@/lib/logs/types";
import { normalizeOptionalString } from "@/lib/utils";

/**
 * Parses a JSON-encoded listing filter string into a ListingIdentity.
 * Returns `undefined` when the input is empty/missing and `null` when parsing fails.
 */
export const parseListingFilter = (
  value: string | undefined,
): ListingIdentity | undefined | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;

  try {
    const parsed = JSON.parse(normalized);
    return toListingValueObject(parsed);
  } catch {
    return null;
  }
};

export const parseListingFilters = (
  value: string | undefined,
): ListingIdentity[] | undefined | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;

  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const listings = parsed
      .map((entry) => toListingValueObject(entry))
      .filter((entry): entry is ListingIdentity => Boolean(entry));

    return listings;
  } catch {
    return null;
  }
};

type RawLogRow = {
  id: string;
  workflowId: string;
  executionId: string | null;
  level: string;
  trigger: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  totalDurationMs: number | null;
  executionData: any;
  cost: any;
  files: any;
  createdAt: Date;
  workflowName: string;
  workflowDescription: string | null;
  workflowColor: string;
  workflowFolderId?: string | null;
  workflowFolderName?: string | null;
  workflowUserId?: string | null;
  workflowWorkspaceId?: string | null;
  workflowCreatedAt?: Date | null;
  workflowUpdatedAt?: Date | null;
};

export const getMonitorSnapshot = (executionData: unknown) => {
  const snapshot = (executionData as any)?.trigger?.data?.monitor;
  return snapshot && typeof snapshot === "object" ? snapshot : null;
};

const collectStatuses = (executionData: unknown): string[] => {
  const traceSpanStatuses = Array.isArray((executionData as any)?.traceSpans)
    ? (executionData as any).traceSpans
        .map((span: any) =>
          typeof span?.status === "string" ? span.status : null,
        )
        .filter((status: string | null): status is string => Boolean(status))
    : [];

  if (traceSpanStatuses.length > 0) {
    return traceSpanStatuses;
  }

  return Array.isArray((executionData as any)?.blockExecutions)
    ? (executionData as any).blockExecutions
        .map((execution: any) =>
          typeof execution?.status === "string" ? execution.status : null,
        )
        .filter((status: string | null): status is string => Boolean(status))
    : [];
};

export const deriveWorkflowLogOutcome = (
  row: Pick<RawLogRow, "endedAt" | "level" | "executionData">,
): WorkflowLogOutcome => {
  if (row.endedAt === null) {
    return "running";
  }

  const statuses = collectStatuses(row.executionData);

  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.length > 0 && statuses.every((status) => status === "skipped")) {
    return "skipped";
  }

  if (statuses.length > 0) {
    return "success";
  }

  if (row.level === "error") {
    return "error";
  }

  return "unknown";
};

const synthesizeTraceSpans = (executionData: unknown): TraceSpan[] | undefined => {
  if (!executionData || typeof executionData !== "object") {
    return undefined;
  }

  const existingTraceSpans = Array.isArray((executionData as any).traceSpans)
    ? ((executionData as any).traceSpans as TraceSpan[])
    : [];
  if (existingTraceSpans.length > 0) {
    return existingTraceSpans;
  }

  if (!Array.isArray((executionData as any).blockExecutions)) {
    return undefined;
  }

  const synthesizedTraceSpans: TraceSpan[] = [];

  ((executionData as any).blockExecutions as any[]).forEach((execution) => {
    const startTime =
      typeof execution?.startedAt === "string" ? execution.startedAt : null;
    const endTime =
      typeof execution?.endedAt === "string" ? execution.endedAt : null;

    if (!startTime || !endTime) {
      return;
    }

    const duration =
      typeof execution?.durationMs === "number"
        ? execution.durationMs
        : Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());

    synthesizedTraceSpans.push({
      id:
        typeof execution?.id === "string"
          ? execution.id
          : typeof execution?.blockId === "string"
            ? execution.blockId
            : crypto.randomUUID(),
      name:
        typeof execution?.blockName === "string" && execution.blockName
          ? execution.blockName
          : typeof execution?.blockId === "string" && execution.blockId
            ? execution.blockId
            : "Block execution",
      type:
        typeof execution?.blockType === "string" && execution.blockType
          ? execution.blockType
          : "block",
      duration,
      startTime,
      endTime,
      status: execution?.status === "error" ? "error" : "success",
      blockId:
        typeof execution?.blockId === "string" ? execution.blockId : undefined,
      input:
        execution?.inputData && typeof execution.inputData === "object"
          ? execution.inputData
          : undefined,
      output:
        execution?.outputData && typeof execution.outputData === "object"
          ? execution.outputData
          : undefined,
      cost:
        execution?.cost && typeof execution.cost === "object"
          ? {
              input:
                typeof execution.cost.input === "number"
                  ? execution.cost.input
                  : undefined,
              output:
                typeof execution.cost.output === "number"
                  ? execution.cost.output
                  : undefined,
              total:
                typeof execution.cost.total === "number"
                  ? execution.cost.total
                  : undefined,
            }
          : undefined,
    });
  });

  return synthesizedTraceSpans.length > 0 ? synthesizedTraceSpans : undefined;
};

export const serializeWorkflowLog = (
  row: RawLogRow,
  details: "basic" | "full",
): WorkflowLog => {
  if (!row.startedAt) {
    throw new Error(`Workflow log ${row.id} is missing startedAt`);
  }

  const workflow = {
    id: row.workflowId,
    name: row.workflowName,
    description: row.workflowDescription,
    color: row.workflowColor,
    folderId: row.workflowFolderId ?? null,
    folderName: row.workflowFolderName ?? null,
    userId: row.workflowUserId ?? null,
    workspaceId: row.workflowWorkspaceId ?? null,
  };
  const executionData =
    details === "full" && row.executionData
      ? {
          ...row.executionData,
          traceSpans: synthesizeTraceSpans(row.executionData),
        }
      : undefined;

  return {
    id: row.id,
    workflowId: row.workflowId,
    executionId: row.executionId ?? null,
    level: row.level,
    trigger: row.trigger ?? null,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationMs: row.totalDurationMs ?? null,
    outcome: deriveWorkflowLogOutcome(row),
    workflow,
    files: details === "full" ? row.files || undefined : undefined,
    cost: row.cost || undefined,
    executionData,
  };
};

const compareListingIdentity = (
  left: ListingIdentity | null | undefined,
  right: ListingIdentity,
) => {
  const normalizedLeft = toListingValueObject(left ?? null);
  const normalizedRight = toListingValueObject(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};

const toMonitorAssetType = (snapshot: any) => {
  const value =
    normalizeOptionalString(snapshot?.listing?.assetClass) ??
    normalizeOptionalString(snapshot?.listing?.base_asset_class) ??
    normalizeOptionalString(snapshot?.listing?.listing_type) ??
    "unknown";

  return value.toLowerCase();
};

const matchesValueList = (value: string | null | undefined, list: string[]) => {
  if (!value) return false;
  return list.some((entry) => entry === value);
};

const matchesTextList = (value: string | null | undefined, list: string[]) => {
  if (!value) return false;
  const normalizedValue = value.toLowerCase();
  return list.some((entry) => normalizedValue.includes(entry.toLowerCase()));
};

export const matchesWorkflowLogFilters = (
  log: WorkflowLog,
  filters: {
    search?: string;
    level?: string[];
    excludeLevel?: string[];
    outcomes?: string[];
    excludeOutcomes?: string[];
    triggers?: string[];
    excludeTriggers?: string[];
    workflowIds?: string[];
    excludeWorkflowIds?: string[];
    workflowNames?: string[];
    excludeWorkflowNames?: string[];
    folderNames?: string[];
    excludeFolderNames?: string[];
    monitorId?: string[];
    excludeMonitorId?: string[];
    indicatorId?: string[];
    providerId?: string[];
    excludeProviderId?: string[];
    interval?: string[];
    excludeInterval?: string[];
    listings?: ListingIdentity[];
    excludeListings?: ListingIdentity[];
    assetTypes?: string[];
    excludeAssetTypes?: string[];
    hasFields?: string[];
    noFields?: string[];
    startedAtFrom?: string;
    startedAtFromExclusive?: boolean;
    startedAtTo?: string;
    startedAtToExclusive?: boolean;
    endedAtFrom?: string;
    endedAtFromExclusive?: boolean;
    endedAtTo?: string;
    endedAtToExclusive?: boolean;
    durationMinMs?: number;
    durationMinMsExclusive?: boolean;
    durationMaxMs?: number;
    durationMaxMsExclusive?: boolean;
    costMin?: number;
    costMinExclusive?: boolean;
    costMax?: number;
    costMaxExclusive?: boolean;
  },
) => {
  const monitorSnapshot = getMonitorSnapshot(log.executionData);

  if (filters.search) {
    const haystack = [
      log.executionId,
      log.workflow?.name,
      monitorSnapshot?.id,
      monitorSnapshot?.indicatorId,
      monitorSnapshot?.providerId,
      monitorSnapshot?.interval,
      monitorSnapshot?.listing?.listing_id,
      monitorSnapshot?.listing?.base_id,
      monitorSnapshot?.listing?.quote_id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(filters.search.toLowerCase())) {
      return false;
    }
  }

  if (filters.level?.length && !matchesValueList(log.level, filters.level))
    return false;
  if (
    filters.excludeLevel?.length &&
    matchesValueList(log.level, filters.excludeLevel)
  )
    return false;
  if (
    filters.outcomes?.length &&
    !matchesValueList(log.outcome, filters.outcomes)
  )
    return false;
  if (
    filters.excludeOutcomes?.length &&
    matchesValueList(log.outcome, filters.excludeOutcomes)
  )
    return false;
  if (
    filters.triggers?.length &&
    !matchesValueList(log.trigger, filters.triggers)
  )
    return false;
  if (
    filters.excludeTriggers?.length &&
    matchesValueList(log.trigger, filters.excludeTriggers)
  ) {
    return false;
  }
  if (
    filters.workflowIds?.length &&
    !matchesValueList(log.workflowId, filters.workflowIds)
  ) {
    return false;
  }
  if (
    filters.excludeWorkflowIds?.length &&
    matchesValueList(log.workflowId, filters.excludeWorkflowIds)
  ) {
    return false;
  }
  if (
    filters.workflowNames?.length &&
    !matchesTextList(log.workflow?.name, filters.workflowNames)
  ) {
    return false;
  }
  if (
    filters.excludeWorkflowNames?.length &&
    matchesTextList(log.workflow?.name, filters.excludeWorkflowNames)
  ) {
    return false;
  }

  if (
    filters.folderNames?.length &&
    !matchesTextList(log.workflow?.folderName, filters.folderNames)
  ) {
    return false;
  }
  if (
    filters.excludeFolderNames?.length &&
    matchesTextList(log.workflow?.folderName, filters.excludeFolderNames)
  ) {
    return false;
  }

  if (
    filters.monitorId?.length &&
    !matchesValueList(monitorSnapshot?.id, filters.monitorId)
  )
    return false;
  if (
    filters.excludeMonitorId?.length &&
    matchesValueList(monitorSnapshot?.id, filters.excludeMonitorId)
  ) {
    return false;
  }
  if (
    filters.indicatorId?.length &&
    !matchesValueList(monitorSnapshot?.indicatorId, filters.indicatorId)
  ) {
    return false;
  }
  if (
    filters.providerId?.length &&
    !matchesValueList(monitorSnapshot?.providerId, filters.providerId)
  ) {
    return false;
  }
  if (
    filters.excludeProviderId?.length &&
    matchesValueList(monitorSnapshot?.providerId, filters.excludeProviderId)
  ) {
    return false;
  }
  if (
    filters.interval?.length &&
    !matchesValueList(monitorSnapshot?.interval, filters.interval)
  )
    return false;
  if (
    filters.excludeInterval?.length &&
    matchesValueList(monitorSnapshot?.interval, filters.excludeInterval)
  ) {
    return false;
  }

  if (
    filters.listings?.length &&
    !filters.listings.some((listing) =>
      compareListingIdentity(monitorSnapshot?.listing, listing),
    )
  ) {
    return false;
  }
  if (
    filters.excludeListings?.length &&
    filters.excludeListings.some((listing) =>
      compareListingIdentity(monitorSnapshot?.listing, listing),
    )
  ) {
    return false;
  }

  const assetType = toMonitorAssetType(monitorSnapshot);
  if (
    filters.assetTypes?.length &&
    !matchesValueList(assetType, filters.assetTypes)
  )
    return false;
  if (
    filters.excludeAssetTypes?.length &&
    matchesValueList(assetType, filters.excludeAssetTypes)
  ) {
    return false;
  }

  if (filters.hasFields?.length) {
    const hasValues = {
      monitor: Boolean(monitorSnapshot?.id),
      listing: Boolean(monitorSnapshot?.listing),
      indicator: Boolean(monitorSnapshot?.indicatorId),
      provider: Boolean(monitorSnapshot?.providerId),
      interval: Boolean(monitorSnapshot?.interval),
      endedAt: Boolean(log.endedAt),
      cost: typeof log.cost?.total === "number",
    };

    if (
      !filters.hasFields.every(
        (field) => hasValues[field as keyof typeof hasValues],
      )
    ) {
      return false;
    }
  }

  if (filters.noFields?.length) {
    const hasValues = {
      monitor: Boolean(monitorSnapshot?.id),
      listing: Boolean(monitorSnapshot?.listing),
      indicator: Boolean(monitorSnapshot?.indicatorId),
      provider: Boolean(monitorSnapshot?.providerId),
      interval: Boolean(monitorSnapshot?.interval),
      endedAt: Boolean(log.endedAt),
      cost: typeof log.cost?.total === "number",
    };

    if (
      !filters.noFields.every(
        (field) => !hasValues[field as keyof typeof hasValues],
      )
    ) {
      return false;
    }
  }

  const startedAtMs = log.startedAt ? new Date(log.startedAt).getTime() : NaN;
  const endedAtMs = log.endedAt ? new Date(log.endedAt).getTime() : NaN;

  if (
    filters.startedAtFrom &&
    (filters.startedAtFromExclusive
      ? startedAtMs <= new Date(filters.startedAtFrom).getTime()
      : startedAtMs < new Date(filters.startedAtFrom).getTime())
  ) {
    return false;
  }
  if (
    filters.startedAtTo &&
    (filters.startedAtToExclusive
      ? startedAtMs >= new Date(filters.startedAtTo).getTime()
      : startedAtMs > new Date(filters.startedAtTo).getTime())
  ) {
    return false;
  }
  if (
    filters.endedAtFrom &&
    (!log.endedAt ||
      (filters.endedAtFromExclusive
        ? endedAtMs <= new Date(filters.endedAtFrom).getTime()
        : endedAtMs < new Date(filters.endedAtFrom).getTime()))
  ) {
    return false;
  }
  if (
    filters.endedAtTo &&
    (!log.endedAt ||
      (filters.endedAtToExclusive
        ? endedAtMs >= new Date(filters.endedAtTo).getTime()
        : endedAtMs > new Date(filters.endedAtTo).getTime()))
  ) {
    return false;
  }
  if (
    typeof filters.durationMinMs === "number" &&
    (filters.durationMinMsExclusive
      ? (log.durationMs ?? -1) <= filters.durationMinMs
      : (log.durationMs ?? -1) < filters.durationMinMs)
  ) {
    return false;
  }
  if (
    typeof filters.durationMaxMs === "number" &&
    (filters.durationMaxMsExclusive
      ? (log.durationMs ?? Number.MAX_SAFE_INTEGER) >= filters.durationMaxMs
      : (log.durationMs ?? Number.MAX_SAFE_INTEGER) > filters.durationMaxMs)
  ) {
    return false;
  }

  const totalCost = typeof log.cost?.total === "number" ? log.cost.total : 0;
  if (
    typeof filters.costMin === "number" &&
    (filters.costMinExclusive
      ? totalCost <= filters.costMin
      : totalCost < filters.costMin)
  ) {
    return false;
  }
  if (
    typeof filters.costMax === "number" &&
    (filters.costMaxExclusive
      ? totalCost >= filters.costMax
      : totalCost > filters.costMax)
  ) {
    return false;
  }

  return true;
};

export const toPaginatedLogsResponse = (
  logs: WorkflowLog[],
  pageSize: number,
  offset: number,
): LogsResponse => {
  const page = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));

  return {
    data: logs.slice(offset, offset + pageSize),
    total: logs.length,
    page,
    pageSize,
    totalPages,
  };
};
