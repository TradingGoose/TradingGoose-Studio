import { toListingValueObject } from "@/lib/listing/identity";

export const MONITOR_LAYOUTS = ["kanban", "timeline"] as const;
export const MONITOR_GROUP_FIELDS = [
  "outcome",
  "workflow",
  "trigger",
  "listing",
  "assetType",
  "provider",
  "interval",
  "monitor",
] as const;
export const MONITOR_SORT_FIELDS = [
  "startedAt",
  "endedAt",
  "durationMs",
  "cost",
  "workflowName",
  "providerId",
  "interval",
  "listingLabel",
] as const;
export const MONITOR_SORT_DIRECTIONS = ["asc", "desc"] as const;
export const MONITOR_FIELD_SUMS = ["count", "durationMs", "cost"] as const;
export const MONITOR_TIMELINE_ZOOM = ["day", "week", "month"] as const;
export const MONITOR_TIMELINE_SCALE_MIN = 60;
export const MONITOR_TIMELINE_SCALE_MAX = 180;
export const MONITOR_TIMELINE_SCALE_STEP = 20;
export const DEFAULT_MONITOR_TIMEZONE = "UTC";
export const MONITOR_VISIBLE_FIELDS = [
  "workflow",
  "provider",
  "interval",
  "assetType",
  "trigger",
  "startedAt",
  "endedAt",
  "durationMs",
  "cost",
  "monitor",
] as const;
export const MONITOR_QUICK_FILTER_FIELDS = [
  "outcome",
  "workflow",
  "trigger",
  "listing",
  "assetType",
  "provider",
  "interval",
  "monitor",
] as const;
export const MONITOR_QUICK_FILTER_OPERATORS = [
  "include",
  "exclude",
  "has",
  "no",
] as const;

export type MonitorLayout = (typeof MONITOR_LAYOUTS)[number];
export type MonitorGroupField = (typeof MONITOR_GROUP_FIELDS)[number];
export type MonitorSortField = (typeof MONITOR_SORT_FIELDS)[number];
export type MonitorSortDirection = (typeof MONITOR_SORT_DIRECTIONS)[number];
export type MonitorFieldSum = (typeof MONITOR_FIELD_SUMS)[number];
export type MonitorTimelineZoom = (typeof MONITOR_TIMELINE_ZOOM)[number];
export type MonitorVisibleFieldId = (typeof MONITOR_VISIBLE_FIELDS)[number];
export type MonitorQuickFilterField =
  (typeof MONITOR_QUICK_FILTER_FIELDS)[number];
export type MonitorQuickFilterOperator =
  (typeof MONITOR_QUICK_FILTER_OPERATORS)[number];

export type MonitorQuickFilter = {
  field: MonitorQuickFilterField;
  operator: MonitorQuickFilterOperator;
  values: string[];
};

export type MonitorSortRule = {
  field: MonitorSortField;
  direction: MonitorSortDirection;
};

export type MonitorViewConfig = {
  layout: MonitorLayout;
  filterQuery: string;
  quickFilters: MonitorQuickFilter[];
  sortBy: MonitorSortRule[];
  groupBy: MonitorGroupField;
  verticalGroupBy: MonitorGroupField | null;
  sliceBy: MonitorGroupField | null;
  fieldSums: MonitorFieldSum[];
  timezone: string;
  kanban: {
    columnField: MonitorGroupField;
    hiddenColumnIds: string[];
    columnLimits: Record<string, number>;
    localCardOrder: Record<string, string[]>;
    visibleFieldIds: MonitorVisibleFieldId[];
  };
  timeline: {
    dateFields: {
      start: "startedAt";
      end: "endedAt";
    };
    markers: {
      today: boolean;
      intervalBoundaries: boolean;
    };
    zoom: MonitorTimelineZoom;
    scale: number;
  };
};

export type MonitorShellWorkingState = {
  isMonitorsPaneOpen: boolean;
  outerPanelSizes: [number, number] | null;
  innerPanelSizes: [number, number] | null;
};

export type MonitorViewRow = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  config: MonitorViewConfig;
  createdAt: string;
  updatedAt: string;
};

export type MonitorViewRowResponse = MonitorViewRow;

export type MonitorViewsListResponse = {
  data: MonitorViewRowResponse[];
};

export type CreateMonitorViewBody = {
  name: string;
  config: MonitorViewConfig;
  makeActive?: boolean;
};

export type UpdateMonitorViewBody = {
  name?: string;
  config?: MonitorViewConfig;
};

export const DEFAULT_MONITOR_VIEW_CONFIG: MonitorViewConfig = {
  layout: "kanban",
  filterQuery: "",
  quickFilters: [],
  sortBy: [{ field: "startedAt", direction: "desc" }],
  groupBy: "outcome",
  verticalGroupBy: null,
  sliceBy: null,
  fieldSums: ["count"],
  timezone: DEFAULT_MONITOR_TIMEZONE,
  kanban: {
    columnField: "outcome",
    hiddenColumnIds: [],
    columnLimits: {},
    localCardOrder: {},
    visibleFieldIds: [
      "workflow",
      "provider",
      "interval",
      "startedAt",
      "durationMs",
    ],
  },
  timeline: {
    dateFields: {
      start: "startedAt",
      end: "endedAt",
    },
    markers: {
      today: true,
      intervalBoundaries: true,
    },
    zoom: "week",
    scale: 100,
  },
};

export const DEFAULT_MONITOR_SHELL_WORKING_STATE: MonitorShellWorkingState = {
  isMonitorsPaneOpen: true,
  outerPanelSizes: null,
  innerPanelSizes: null,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const uniqueStrings = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();

  value.forEach((entry) => {
    if (typeof entry !== "string") return;
    const trimmed = entry.trim();
    if (!trimmed) return;
    unique.add(trimmed);
  });

  return Array.from(unique);
};

const uniqueValues = <T extends string>(
  value: unknown,
  allowed: readonly T[],
) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<T>();

  value.forEach((entry) => {
    if (typeof entry !== "string") return;
    if (allowed.includes(entry as T)) {
      unique.add(entry as T);
    }
  });

  return Array.from(unique);
};

const normalizeAllowedArray = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
) => {
  if (typeof value === "undefined") {
    return fallback;
  }

  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = uniqueValues(value, allowed);
  if (value.length > 0 && normalized.length === 0) {
    return fallback;
  }

  return normalized;
};

const normalizePanelSizes = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null;

  const first = typeof value[0] === "number" ? value[0] : Number.NaN;
  const second = typeof value[1] === "number" ? value[1] : Number.NaN;

  if (
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    first <= 0 ||
    second <= 0
  ) {
    return null;
  }

  if (Math.abs(first + second - 100) > 1) {
    return null;
  }

  return [first, second];
};

const normalizeGroupField = (
  value: unknown,
  fallback: MonitorGroupField,
): MonitorGroupField =>
  typeof value === "string" &&
  MONITOR_GROUP_FIELDS.includes(value as MonitorGroupField)
    ? (value as MonitorGroupField)
    : fallback;

const normalizeNullableGroupField = (
  value: unknown,
): MonitorGroupField | null =>
  typeof value === "string" &&
  MONITOR_GROUP_FIELDS.includes(value as MonitorGroupField)
    ? (value as MonitorGroupField)
    : null;

const normalizeLayout = (value: unknown): MonitorLayout =>
  typeof value === "string" && MONITOR_LAYOUTS.includes(value as MonitorLayout)
    ? (value as MonitorLayout)
    : DEFAULT_MONITOR_VIEW_CONFIG.layout;

const normalizeTimelineScale = (value: unknown) => {
  const rawValue = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_MONITOR_VIEW_CONFIG.timeline.scale;
  }

  const stepped =
    Math.round(rawValue / MONITOR_TIMELINE_SCALE_STEP) *
    MONITOR_TIMELINE_SCALE_STEP;
  return Math.min(
    MONITOR_TIMELINE_SCALE_MAX,
    Math.max(MONITOR_TIMELINE_SCALE_MIN, stepped),
  );
};

const normalizeTimezone = (value: unknown) => {
  if (typeof value !== "string") {
    return DEFAULT_MONITOR_VIEW_CONFIG.timezone;
  }

  const trimmed = value.trim();
  return trimmed || DEFAULT_MONITOR_VIEW_CONFIG.timezone;
};

const normalizeSortBy = (value: unknown): MonitorSortRule[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_MONITOR_VIEW_CONFIG.sortBy;
  }

  const seenFields = new Set<MonitorSortField>();
  const normalized = value
    .map((entry) => {
      if (!isObject(entry)) return null;
      const field =
        typeof entry.field === "string" &&
        MONITOR_SORT_FIELDS.includes(entry.field as MonitorSortField)
          ? (entry.field as MonitorSortField)
          : null;
      const direction =
        typeof entry.direction === "string" &&
        MONITOR_SORT_DIRECTIONS.includes(
          entry.direction as MonitorSortDirection,
        )
          ? (entry.direction as MonitorSortDirection)
          : null;

      if (!field || !direction || seenFields.has(field)) {
        return null;
      }

      seenFields.add(field);
      return { field, direction } satisfies MonitorSortRule;
    })
    .filter((entry): entry is MonitorSortRule => Boolean(entry))
    .slice(0, 2);

  return normalized;
};

const normalizeQuickFilters = (value: unknown): MonitorQuickFilter[] => {
  if (!Array.isArray(value)) return [];

  const normalizeQuickFilterValues = (
    field: MonitorQuickFilterField,
    rawValue: unknown,
  ) => {
    if (!Array.isArray(rawValue)) return [];

    const normalized = new Set<string>();

    rawValue.forEach((entry) => {
      if (typeof entry !== "string") return;
      const trimmed = entry.trim();
      if (!trimmed) return;

      switch (field) {
        case "workflow":
        case "monitor":
        case "provider": {
          const normalizedId = trimmed.startsWith("#")
            ? trimmed.slice(1).trim()
            : trimmed;
          if (normalizedId) {
            normalized.add(normalizedId);
          }
          return;
        }
        case "listing": {
          try {
            const normalizedListing = toListingValueObject(JSON.parse(trimmed));
            if (!normalizedListing) return;
            normalized.add(JSON.stringify(normalizedListing));
          } catch {
            return;
          }
          return;
        }
        case "assetType":
          normalized.add(trimmed.toLowerCase());
          return;
        case "outcome":
        case "trigger":
        case "interval":
          normalized.add(trimmed.toLowerCase());
          return;
      }
    });

    return Array.from(normalized);
  };

  return value
    .map((entry) => {
      if (!isObject(entry)) return null;
      const field =
        typeof entry.field === "string" &&
        MONITOR_QUICK_FILTER_FIELDS.includes(
          entry.field as MonitorQuickFilterField,
        )
          ? (entry.field as MonitorQuickFilterField)
          : null;
      const operator =
        typeof entry.operator === "string" &&
        MONITOR_QUICK_FILTER_OPERATORS.includes(
          entry.operator as MonitorQuickFilterOperator,
        )
          ? (entry.operator as MonitorQuickFilterOperator)
          : null;

      if (!field || !operator) return null;

      const values = normalizeQuickFilterValues(field, entry.values);
      if (
        (operator === "include" || operator === "exclude") &&
        values.length === 0
      ) {
        return null;
      }
      if ((operator === "has" || operator === "no") && values.length > 0) {
        return null;
      }

      return {
        field,
        operator,
        values: operator === "has" || operator === "no" ? [] : values,
      } satisfies MonitorQuickFilter;
    })
    .filter((entry): entry is MonitorQuickFilter => Boolean(entry));
};

const normalizeColumnLimits = (value: unknown) => {
  if (!isObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, rawValue]) => {
        const limit = typeof rawValue === "number" ? rawValue : Number.NaN;
        if (!key.trim() || !Number.isFinite(limit) || limit <= 0) {
          return null;
        }
        return [key.trim(), Math.round(limit)] as const;
      })
      .filter((entry): entry is readonly [string, number] => Boolean(entry)),
  );
};

const normalizeLocalCardOrder = (value: unknown) => {
  if (!isObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([columnId, rawValues]) => {
        const values = uniqueStrings(rawValues);
        if (!columnId.trim() || values.length === 0) {
          return null;
        }
        return [columnId.trim(), values] as const;
      })
      .filter((entry): entry is readonly [string, string[]] => Boolean(entry)),
  );
};

export const normalizeMonitorViewConfig = (
  value: unknown,
): MonitorViewConfig => {
  const record = isObject(value) ? value : {};
  const kanban = isObject(record.kanban) ? record.kanban : {};
  const timeline = isObject(record.timeline) ? record.timeline : {};
  const timelineDateFields = isObject(timeline.dateFields)
    ? timeline.dateFields
    : {};
  const timelineMarkers = isObject(timeline.markers) ? timeline.markers : {};

  return {
    layout: normalizeLayout(record.layout),
    filterQuery:
      typeof record.filterQuery === "string" ? record.filterQuery.trim() : "",
    quickFilters: normalizeQuickFilters(record.quickFilters),
    sortBy: normalizeSortBy(record.sortBy),
    groupBy: normalizeGroupField(
      record.groupBy,
      DEFAULT_MONITOR_VIEW_CONFIG.groupBy,
    ),
    verticalGroupBy: normalizeNullableGroupField(record.verticalGroupBy),
    sliceBy: normalizeNullableGroupField(record.sliceBy),
    fieldSums: normalizeAllowedArray(
      record.fieldSums,
      MONITOR_FIELD_SUMS,
      DEFAULT_MONITOR_VIEW_CONFIG.fieldSums,
    ),
    timezone: normalizeTimezone(record.timezone),
    kanban: {
      columnField: normalizeGroupField(
        kanban.columnField,
        DEFAULT_MONITOR_VIEW_CONFIG.kanban.columnField,
      ),
      hiddenColumnIds: uniqueStrings(kanban.hiddenColumnIds),
      columnLimits: normalizeColumnLimits(kanban.columnLimits),
      localCardOrder: normalizeLocalCardOrder(kanban.localCardOrder),
      visibleFieldIds: normalizeAllowedArray(
        kanban.visibleFieldIds,
        MONITOR_VISIBLE_FIELDS,
        DEFAULT_MONITOR_VIEW_CONFIG.kanban.visibleFieldIds,
      ),
    },
    timeline: {
      dateFields: {
        start:
          timelineDateFields.start === "startedAt" ? "startedAt" : "startedAt",
        end: "endedAt",
      },
      markers: {
        today:
          typeof timelineMarkers.today === "boolean"
            ? timelineMarkers.today
            : DEFAULT_MONITOR_VIEW_CONFIG.timeline.markers.today,
        intervalBoundaries:
          typeof timelineMarkers.intervalBoundaries === "boolean"
            ? timelineMarkers.intervalBoundaries
            : DEFAULT_MONITOR_VIEW_CONFIG.timeline.markers.intervalBoundaries,
      },
      zoom:
        typeof timeline.zoom === "string" &&
        MONITOR_TIMELINE_ZOOM.includes(timeline.zoom as MonitorTimelineZoom)
          ? (timeline.zoom as MonitorTimelineZoom)
          : DEFAULT_MONITOR_VIEW_CONFIG.timeline.zoom,
      scale: normalizeTimelineScale(timeline.scale),
    },
  };
};

export const normalizeMonitorShellWorkingState = (
  value: unknown,
): MonitorShellWorkingState => {
  if (!isObject(value)) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE;
  }

  return {
    isMonitorsPaneOpen:
      typeof value.isMonitorsPaneOpen === "boolean"
        ? value.isMonitorsPaneOpen
        : DEFAULT_MONITOR_SHELL_WORKING_STATE.isMonitorsPaneOpen,
    outerPanelSizes: normalizePanelSizes(value.outerPanelSizes),
    innerPanelSizes: normalizePanelSizes(value.innerPanelSizes),
  };
};
