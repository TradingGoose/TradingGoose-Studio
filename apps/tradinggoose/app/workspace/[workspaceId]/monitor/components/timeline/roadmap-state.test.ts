import { describe, expect, it } from "vitest";
import type { MonitorExecutionItem } from "../data/execution-ordering";
import { buildMonitorRoadmapGroups } from "./roadmap-state";
import { DEFAULT_MONITOR_VIEW_CONFIG } from "../view/view-config";

const buildExecution = (
  overrides: Partial<MonitorExecutionItem>,
): MonitorExecutionItem => ({
  logId: "log-1",
  workflowId: "wf-1",
  executionId: "exec-1",
  startedAt: "2026-04-23T00:00:00.000Z",
  endedAt: "2026-04-23T00:05:00.000Z",
  durationMs: 300000,
  outcome: "success",
  trigger: "manual",
  workflowName: "Workflow One",
  workflowColor: "#3972F6",
  monitorId: "monitor-1",
  providerId: "alpaca",
  interval: "1m",
  indicatorId: "rsi",
  assetType: "stock",
  listing: null,
  listingLabel: "AAPL",
  cost: 0.12,
  isOrphaned: false,
  isPartial: false,
  sourceLog: {
    id: "log-1",
    workflowId: "wf-1",
    executionId: "exec-1",
    level: "info",
    trigger: "manual",
    startedAt: "2026-04-23T00:00:00.000Z",
    endedAt: "2026-04-23T00:05:00.000Z",
    durationMs: 300000,
    outcome: "success",
  },
  ...overrides,
});

describe("buildMonitorRoadmapGroups", () => {
  it("falls back to startedAt when the source log has no endedAt", () => {
    const groups = buildMonitorRoadmapGroups(
      [buildExecution({ endedAt: null })],
      DEFAULT_MONITOR_VIEW_CONFIG,
    );

    expect(groups[0]?.items[0]?.startAt.toISOString()).toBe(
      "2026-04-23T00:00:00.000Z",
    );
    expect(groups[0]?.items[0]?.endAt.toISOString()).toBe(
      "2026-04-23T00:00:00.000Z",
    );
  });

  it("uses the shared execution ordering helper for group ordering", () => {
    const groups = buildMonitorRoadmapGroups(
      [
        buildExecution({ logId: "log-1", outcome: "success" }),
        buildExecution({ logId: "log-2", outcome: "running" }),
        buildExecution({ logId: "log-3", outcome: "error" }),
      ],
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        groupBy: "outcome",
      },
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Running",
      "Error",
      "Success",
    ]);
  });

  it("computes configured field sums for timeline groups", () => {
    const groups = buildMonitorRoadmapGroups(
      [
        buildExecution({ logId: "log-1", durationMs: 300000, cost: 0.12 }),
        buildExecution({ logId: "log-2", durationMs: 120000, cost: 0.08 }),
      ],
      {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        groupBy: "workflow",
        fieldSums: ["count", "durationMs", "cost"],
      },
    );

    expect(groups[0]?.aggregates).toEqual({
      count: 2,
      durationMs: 420000,
      cost: 0.2,
    });
  });
});
