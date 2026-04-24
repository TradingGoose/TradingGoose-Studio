import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  toListingValueObject,
  type ListingIdentity,
} from "@/lib/listing/identity";
import { LOGS_QUERY_POLICY } from "@/lib/logs/query-policy";
import { parseQuery, queryToApiParams } from "@/lib/logs/query-parser";
import type { QueryPolicy } from "@/lib/logs/query-types";
import type { LogsResponse, WorkflowLog } from "@/stores/logs/filters/types";

export const logKeys = {
  all: ["logs"] as const,
  lists: () => [...logKeys.all, "list"] as const,
  list: (workspaceId: string | undefined, filters: Omit<LogFilters, "page">) =>
    [...logKeys.lists(), workspaceId ?? "", filters] as const,
  details: () => [...logKeys.all, "detail"] as const,
  detail: (logId: string | undefined) =>
    [...logKeys.details(), logId ?? ""] as const,
  metrics: () => [...logKeys.all, "metrics"] as const,
  executions: (workspaceId: string | undefined, filters: Record<string, any>) =>
    [...logKeys.metrics(), "executions", workspaceId ?? "", filters] as const,
  workflowLogs: (
    workspaceId: string | undefined,
    workflowId: string | undefined,
    filters: Record<string, any>,
  ) =>
    [
      ...logKeys.all,
      "workflow-logs",
      workspaceId ?? "",
      workflowId ?? "",
      filters,
    ] as const,
  globalLogs: (workspaceId: string | undefined, filters: Record<string, any>) =>
    [...logKeys.all, "global-logs", workspaceId ?? "", filters] as const,
};

interface LogFilters {
  timeRange: string;
  level: string;
  workflowIds: string[];
  folderIds: string[];
  triggers: string[];
  searchQuery: string;
  limit: number;
  details?: "basic" | "full";
  queryPolicy?: QueryPolicy;
  queryPolicyKey?: "logs" | "monitor";
  monitorId?: string;
  listings?: ListingIdentity[];
  indicatorId?: string;
  providerId?: string;
  interval?: string;
  triggerSource?: "indicator_trigger";
}

const resolveLogFilters = (
  filters: LogFilters,
): Required<Pick<LogFilters, "details" | "queryPolicy" | "queryPolicyKey">> &
  LogFilters => ({
  ...filters,
  details: filters.details ?? "basic",
  queryPolicy: filters.queryPolicy ?? LOGS_QUERY_POLICY,
  queryPolicyKey: filters.queryPolicyKey ?? "logs",
});

const getLogFilterQueryKey = (
  filters: ReturnType<typeof resolveLogFilters>,
) => ({
  ...filters,
  queryPolicy: undefined,
});

const resolveTimeRangeStartDate = (timeRange: string) => {
  if (timeRange === "All time") {
    return null;
  }

  const now = new Date();

  switch (timeRange) {
    case "Past 30 minutes":
      return new Date(now.getTime() - 30 * 60 * 1000);
    case "Past hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "Past 6 hours":
      return new Date(now.getTime() - 6 * 60 * 60 * 1000);
    case "Past 12 hours":
      return new Date(now.getTime() - 12 * 60 * 60 * 1000);
    case "Past 24 hours":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "Past 3 days":
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    case "Past 7 days":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "Past 14 days":
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    case "Past 30 days":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(0);
  }
};

const MULTI_VALUE_QUERY_PARAMS = new Set([
  "level",
  "excludeLevel",
  "outcomes",
  "excludeOutcomes",
  "workflowIds",
  "excludeWorkflowIds",
  "folderIds",
  "triggers",
  "excludeTriggers",
  "workflowName",
  "excludeWorkflowName",
  "folderName",
  "excludeFolderName",
  "monitorId",
  "excludeMonitorId",
  "providerId",
  "excludeProviderId",
  "interval",
  "excludeInterval",
  "assetTypes",
  "excludeAssetTypes",
  "hasFields",
  "noFields",
]);

const mergeCsvValues = (left: string | null, right: string) => {
  const values = new Set<string>();

  [left ?? "", right].forEach((entry) => {
    entry
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => values.add(value));
  });

  return Array.from(values).join(",");
};

const mergeQueryParam = (
  params: URLSearchParams,
  key: string,
  value: string,
) => {
  if (!MULTI_VALUE_QUERY_PARAMS.has(key) || !params.has(key)) {
    params.set(key, value);
    return;
  }

  params.set(key, mergeCsvValues(params.get(key), value));
};

export function buildLogsRequestParams(
  workspaceId: string,
  filters: LogFilters,
  options?: {
    page?: number;
    includePagination?: boolean;
    includeDetails?: boolean;
  },
) {
  const resolvedFilters = resolveLogFilters(filters);
  const params = new URLSearchParams();
  const currentPage = options?.page ?? 1;
  const includePagination = options?.includePagination ?? true;
  const includeDetails = options?.includeDetails ?? true;

  params.set("workspaceId", workspaceId);
  if (includePagination) {
    params.set("limit", resolvedFilters.limit.toString());
    params.set(
      "offset",
      ((currentPage - 1) * resolvedFilters.limit).toString(),
    );
  }
  if (includeDetails) {
    params.set("details", resolvedFilters.details);
  }

  if (resolvedFilters.level !== "all") {
    params.set("level", resolvedFilters.level);
  }

  if (resolvedFilters.triggers.length > 0) {
    params.set("triggers", resolvedFilters.triggers.join(","));
  }

  if (resolvedFilters.workflowIds.length > 0) {
    params.set("workflowIds", resolvedFilters.workflowIds.join(","));
  }

  if (resolvedFilters.folderIds.length > 0) {
    params.set("folderIds", resolvedFilters.folderIds.join(","));
  }

  const startDate = resolveTimeRangeStartDate(resolvedFilters.timeRange);
  if (startDate) {
    params.set("startDate", startDate.toISOString());
  }

  if (resolvedFilters.searchQuery.trim()) {
    const parsedQuery = parseQuery(
      resolvedFilters.searchQuery.trim(),
      resolvedFilters.queryPolicy,
    );
    const searchParams = queryToApiParams(
      parsedQuery,
      resolvedFilters.queryPolicy,
    );

    for (const [key, value] of Object.entries(searchParams)) {
      mergeQueryParam(params, key, value);
    }
  }

  const normalizedListings = (resolvedFilters.listings ?? [])
    .map((listing) => toListingValueObject(listing))
    .filter((listing): listing is ListingIdentity => Boolean(listing));

  const monitorFilters: Array<[string, string | undefined]> = [
    ["monitorId", resolvedFilters.monitorId],
    [
      "listings",
      normalizedListings.length > 0
        ? JSON.stringify(normalizedListings)
        : undefined,
    ],
    ["indicatorId", resolvedFilters.indicatorId],
    ["providerId", resolvedFilters.providerId],
    ["interval", resolvedFilters.interval],
    ["triggerSource", resolvedFilters.triggerSource],
  ];

  monitorFilters.forEach(([key, value]) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    params.set(key, trimmed);
  });

  return params.toString();
}

async function fetchLogsPage(
  workspaceId: string,
  filters: LogFilters,
  page: number,
): Promise<{
  logs: WorkflowLog[];
  hasMore: boolean;
  nextPage: number | undefined;
}> {
  const queryParams = buildLogsRequestParams(workspaceId, filters, { page });
  const response = await fetch(`/api/logs?${queryParams}`);

  if (!response.ok) {
    throw new Error("Failed to fetch logs");
  }

  const apiData: LogsResponse = await response.json();
  const hasMore =
    apiData.data.length === filters.limit && apiData.page < apiData.totalPages;

  return {
    logs: apiData.data || [],
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  };
}

async function fetchLogDetail(logId: string): Promise<WorkflowLog> {
  const response = await fetch(`/api/logs/${logId}`);

  if (!response.ok) {
    throw new Error("Failed to fetch log details");
  }

  const { data } = await response.json();
  return data;
}

interface UseLogsListOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useLogsList(
  workspaceId: string | undefined,
  filters: LogFilters,
  options?: UseLogsListOptions,
) {
  const resolvedFilters = resolveLogFilters(filters);

  return useInfiniteQuery({
    queryKey: logKeys.list(workspaceId, getLogFilterQueryKey(resolvedFilters)),
    queryFn: ({ pageParam }) =>
      fetchLogsPage(workspaceId as string, resolvedFilters, pageParam),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0, // Always consider stale for real-time logs
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}

export function useLogDetail(logId: string | undefined) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => fetchLogDetail(logId as string),
    enabled: Boolean(logId),
    staleTime: 30 * 1000, // Details can be slightly stale (30 seconds)
  });
}

interface WorkflowSegment {
  timestamp: string;
  hasExecutions: boolean;
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;
  avgDurationMs?: number;
  p50Ms?: number;
  p90Ms?: number;
  p99Ms?: number;
}

interface WorkflowExecution {
  workflowId: string;
  workflowName: string;
  segments: WorkflowSegment[];
  overallSuccessRate: number;
}

interface AggregateSegment {
  timestamp: string;
  totalExecutions: number;
  successfulExecutions: number;
}

interface ExecutionsMetricsResponse {
  workflows: WorkflowExecution[];
  aggregateSegments: AggregateSegment[];
}

interface DashboardMetricsFilters {
  workspaceId: string;
  segments: number;
  startTime: string;
  endTime: string;
  workflowIds?: string[];
  folderIds?: string[];
  triggers?: string[];
}

async function fetchExecutionsMetrics(
  filters: DashboardMetricsFilters,
): Promise<ExecutionsMetricsResponse> {
  const params = new URLSearchParams({
    segments: String(filters.segments),
    startTime: filters.startTime,
    endTime: filters.endTime,
  });

  if (filters.workflowIds && filters.workflowIds.length > 0) {
    params.set("workflowIds", filters.workflowIds.join(","));
  }

  if (filters.folderIds && filters.folderIds.length > 0) {
    params.set("folderIds", filters.folderIds.join(","));
  }

  if (filters.triggers && filters.triggers.length > 0) {
    params.set("triggers", filters.triggers.join(","));
  }

  const response = await fetch(
    `/api/workspaces/${filters.workspaceId}/metrics/executions?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch execution metrics");
  }

  const data = await response.json();

  const workflows: WorkflowExecution[] = (data.workflows || []).map(
    (wf: any) => {
      const segments = (wf.segments || []).map((s: any) => {
        const total = s.totalExecutions || 0;
        const success = s.successfulExecutions || 0;
        const hasExecutions = total > 0;
        const successRate = hasExecutions ? (success / total) * 100 : 100;
        return {
          timestamp: s.timestamp,
          hasExecutions,
          totalExecutions: total,
          successfulExecutions: success,
          successRate,
          avgDurationMs:
            typeof s.avgDurationMs === "number" ? s.avgDurationMs : 0,
          p50Ms: typeof s.p50Ms === "number" ? s.p50Ms : 0,
          p90Ms: typeof s.p90Ms === "number" ? s.p90Ms : 0,
          p99Ms: typeof s.p99Ms === "number" ? s.p99Ms : 0,
        };
      });

      const totals = segments.reduce(
        (acc: { total: number; success: number }, seg: WorkflowSegment) => {
          acc.total += seg.totalExecutions;
          acc.success += seg.successfulExecutions;
          return acc;
        },
        { total: 0, success: 0 },
      );

      const overallSuccessRate =
        totals.total > 0 ? (totals.success / totals.total) * 100 : 100;

      return {
        workflowId: wf.workflowId,
        workflowName: wf.workflowName,
        segments,
        overallSuccessRate,
      };
    },
  );

  const sortedWorkflows = workflows.sort((a, b) => {
    const errA =
      a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0;
    const errB =
      b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0;
    return errB - errA;
  });

  const segmentCount = filters.segments;
  const startTime = new Date(filters.startTime);
  const endTime = new Date(filters.endTime);

  const aggregateSegments: AggregateSegment[] = Array.from(
    { length: segmentCount },
    (_, i) => {
      const base = startTime.getTime();
      const ts = new Date(
        base + Math.floor((i * (endTime.getTime() - base)) / segmentCount),
      );
      return {
        timestamp: ts.toISOString(),
        totalExecutions: 0,
        successfulExecutions: 0,
      };
    },
  );

  for (const wf of data.workflows as any[]) {
    wf.segments.forEach((s: any, i: number) => {
      const index = Math.min(i, segmentCount - 1);
      aggregateSegments[index].totalExecutions += s.totalExecutions || 0;
      aggregateSegments[index].successfulExecutions +=
        s.successfulExecutions || 0;
    });
  }

  return {
    workflows: sortedWorkflows,
    aggregateSegments,
  };
}

interface UseExecutionsMetricsOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useExecutionsMetrics(
  filters: DashboardMetricsFilters,
  options?: UseExecutionsMetricsOptions,
) {
  return useQuery({
    queryKey: logKeys.executions(filters.workspaceId, filters),
    queryFn: () => fetchExecutionsMetrics(filters),
    enabled: Boolean(filters.workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 10 * 1000, // Metrics can be slightly stale (10 seconds)
    placeholderData: keepPreviousData,
  });
}

interface DashboardLogsFilters {
  workspaceId: string;
  startDate: string;
  endDate: string;
  workflowIds?: string[];
  folderIds?: string[];
  triggers?: string[];
  limit: number;
}

interface DashboardLogsPage {
  logs: any[]; // Will be mapped by the consumer
  hasMore: boolean;
  nextPage: number | undefined;
}

async function fetchDashboardLogsPage(
  filters: DashboardLogsFilters,
  page: number,
  workflowId?: string,
): Promise<DashboardLogsPage> {
  const params = new URLSearchParams({
    limit: filters.limit.toString(),
    offset: ((page - 1) * filters.limit).toString(),
    workspaceId: filters.workspaceId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    order: "desc",
    details: "full",
  });

  if (workflowId) {
    params.set("workflowIds", workflowId);
  } else if (filters.workflowIds && filters.workflowIds.length > 0) {
    params.set("workflowIds", filters.workflowIds.join(","));
  }

  if (filters.folderIds && filters.folderIds.length > 0) {
    params.set("folderIds", filters.folderIds.join(","));
  }

  if (filters.triggers && filters.triggers.length > 0) {
    params.set("triggers", filters.triggers.join(","));
  }

  const response = await fetch(`/api/logs?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard logs");
  }

  const data = await response.json();
  const logs = data.data || [];
  const hasMore = logs.length === filters.limit;

  return {
    logs,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  };
}

interface UseDashboardLogsOptions {
  enabled?: boolean;
}

export function useGlobalDashboardLogs(
  filters: DashboardLogsFilters,
  options?: UseDashboardLogsOptions,
) {
  return useInfiniteQuery({
    queryKey: logKeys.globalLogs(filters.workspaceId, filters),
    queryFn: ({ pageParam }) => fetchDashboardLogsPage(filters, pageParam),
    enabled: Boolean(filters.workspaceId) && (options?.enabled ?? true),
    staleTime: 10 * 1000, // Slightly stale (10 seconds)
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}

export function useWorkflowDashboardLogs(
  workflowId: string | undefined,
  filters: DashboardLogsFilters,
  options?: UseDashboardLogsOptions,
) {
  return useInfiniteQuery({
    queryKey: logKeys.workflowLogs(filters.workspaceId, workflowId, filters),
    queryFn: ({ pageParam }) =>
      fetchDashboardLogsPage(filters, pageParam, workflowId),
    enabled:
      Boolean(filters.workspaceId) &&
      Boolean(workflowId) &&
      (options?.enabled ?? true),
    staleTime: 10 * 1000, // Slightly stale (10 seconds)
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}
