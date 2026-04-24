import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONITOR_VIEW_CONFIG,
  normalizeMonitorViewConfig,
} from "./view-config";

describe("normalizeMonitorViewConfig", () => {
  it("falls back to the new execution-workspace defaults for invalid input", () => {
    const normalized = normalizeMonitorViewConfig({
      layout: "legacy",
      filterQuery: "workflow:#wf-1 provider:#alpaca",
      quickFilters: [
        {
          field: "workflow",
          operator: "include",
          values: ["", "#wf-1", "wf-1"],
        },
        {
          field: "listing",
          operator: "include",
          values: [
            "",
            JSON.stringify({
              listing_type: "default",
              listing_id: "AAPL",
              base_id: "ignored",
              quote_id: "ignored",
            }),
            "invalid",
          ],
        },
        { field: "monitor", operator: "has", values: ["ignored"] },
        { field: "assetType", operator: "no", values: ["ignored"] },
      ],
      sortBy: [{ field: "invalid", direction: "desc" }],
      groupBy: "invalid",
      fieldSums: ["count", "wat"],
      kanban: {
        columnField: "provider",
        hiddenColumnIds: ["running", "", "running"],
        columnLimits: { running: 5, broken: 0 },
        localCardOrder: { running: ["log-1", "", "log-1"] },
        visibleFieldIds: ["workflow", "unknown"],
      },
      timeline: {
        markers: { today: false, intervalBoundaries: true },
        zoom: "day",
        scale: 142,
      },
      timezone: "America/New_York",
    });

    expect(normalized).toEqual({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      filterQuery: "workflow:#wf-1 provider:#alpaca",
      quickFilters: [
        { field: "workflow", operator: "include", values: ["wf-1"] },
        {
          field: "listing",
          operator: "include",
          values: [
            JSON.stringify({
              listing_id: "AAPL",
              base_id: "",
              quote_id: "",
              listing_type: "default",
            }),
          ],
        },
      ],
      sortBy: [],
      fieldSums: ["count"],
      kanban: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
        columnField: "provider",
        hiddenColumnIds: ["running"],
        columnLimits: { running: 5 },
        localCardOrder: { running: ["log-1"] },
        visibleFieldIds: ["workflow"],
      },
      timeline: {
        ...DEFAULT_MONITOR_VIEW_CONFIG.timeline,
        markers: { today: false, intervalBoundaries: true },
        zoom: "day",
        scale: 140,
      },
      timezone: "America/New_York",
    });
  });

  it("preserves an explicit unsorted state", () => {
    const normalized = normalizeMonitorViewConfig({
      ...DEFAULT_MONITOR_VIEW_CONFIG,
      sortBy: [],
    });

    expect(normalized.sortBy).toEqual([]);
  });
});
