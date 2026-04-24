/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorExecutionWorkspace } from "./monitor-execution-workspace";
import { DEFAULT_MONITOR_VIEW_CONFIG } from "../view/view-config";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  ResizeObserver?: typeof ResizeObserver;
};

const ResizeObserverMock = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("MonitorExecutionWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    originalResizeObserver = reactActEnvironment.ResizeObserver;
    reactActEnvironment.ResizeObserver = ResizeObserverMock;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalResizeObserver) {
      reactActEnvironment.ResizeObserver = originalResizeObserver;
    } else {
      Reflect.deleteProperty(reactActEnvironment, "ResizeObserver");
    }
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows the dedicated unavailable shell when monitor views fail to load", async () => {
    const onReloadViews = vi.fn();

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="error"
          viewStateReloading={false}
          viewsError="Failed to load monitor views"
          isCreateViewDialogOpen={false}
          effectiveConfig={DEFAULT_MONITOR_VIEW_CONFIG}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={onReloadViews}
        />,
      );
    });

    expect(container.textContent).toContain("Views unavailable");
    expect(container.textContent).toContain("Failed to load monitor views");

    const reloadButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Reload views"),
    );

    if (!(reloadButton instanceof HTMLButtonElement)) {
      throw new Error("Expected reload button to render");
    }

    await act(async () => {
      reloadButton.click();
    });

    expect(onReloadViews).toHaveBeenCalledOnce();
  });

  it("requires detail-route data before rendering the inspector body", async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={DEFAULT_MONITOR_VIEW_CONFIG}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId="log-1"
          selectedExecution={{
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
              workflow: {
                id: "wf-1",
                name: "Workflow One",
                description: null,
                color: "#3972F6",
                folderId: null,
                folderName: null,
                userId: null,
                workspaceId: null,
              },
            },
          }}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Execution details unavailable");
  });

  it("surfaces partial execution snapshot state in the inspector context strip", async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={DEFAULT_MONITOR_VIEW_CONFIG}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId="log-1"
          selectedExecution={{
            logId: "log-1",
            workflowId: "wf-1",
            executionId: "exec-1",
            startedAt: "2026-04-23T00:00:00.000Z",
            endedAt: null,
            durationMs: null,
            outcome: "success",
            trigger: "manual",
            workflowName: "Workflow One",
            workflowColor: "#3972F6",
            monitorId: "monitor-1",
            providerId: null,
            interval: null,
            indicatorId: null,
            assetType: "stock",
            listing: null,
            listingLabel: "AAPL",
            cost: null,
            isOrphaned: false,
            isPartial: true,
            sourceLog: {
              id: "log-1",
              workflowId: "wf-1",
              executionId: "exec-1",
              level: "info",
              trigger: "manual",
              startedAt: "2026-04-23T00:00:00.000Z",
              endedAt: null,
              durationMs: null,
              outcome: "success",
              workflow: {
                id: "wf-1",
                name: "Workflow One",
                description: null,
                color: "#3972F6",
                folderId: null,
                folderName: null,
                userId: null,
                workspaceId: null,
              },
            },
          }}
          selectedExecutionLog={{
            id: "log-1",
            workflowId: "wf-1",
            executionId: "exec-1",
            level: "info",
            trigger: "manual",
            startedAt: "2026-04-23T00:00:00.000Z",
            endedAt: null,
            durationMs: null,
            outcome: "success",
            workflow: {
              id: "wf-1",
              name: "Workflow One",
              description: null,
              color: "#3972F6",
              folderId: null,
              folderName: null,
              userId: null,
              workspaceId: null,
            },
          }}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Snapshot incomplete");
  });

  it("surfaces orphaned execution state in the inspector context strip", async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={DEFAULT_MONITOR_VIEW_CONFIG}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId="log-1"
          selectedExecution={{
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
            isOrphaned: true,
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
              workflow: {
                id: "wf-1",
                name: "Workflow One",
                description: null,
                color: "#3972F6",
                folderId: null,
                folderName: null,
                userId: null,
                workspaceId: null,
              },
            },
          }}
          selectedExecutionLog={{
            id: "log-1",
            workflowId: "wf-1",
            executionId: "exec-1",
            level: "info",
            trigger: "manual",
            startedAt: "2026-04-23T00:00:00.000Z",
            endedAt: "2026-04-23T00:05:00.000Z",
            durationMs: 300000,
            outcome: "success",
            workflow: {
              id: "wf-1",
              name: "Workflow One",
              description: null,
              color: "#3972F6",
              folderId: null,
              folderName: null,
              userId: null,
              workspaceId: null,
            },
          }}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Source monitor unavailable");
  });

  it("preserves the secondary sort when the primary sort field changes", async () => {
    const onUpdateViewConfig = vi.fn();

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={{
            ...DEFAULT_MONITOR_VIEW_CONFIG,
            sortBy: [
              { field: "startedAt", direction: "desc" },
              { field: "providerId", direction: "asc" },
            ],
          }}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={onUpdateViewConfig}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    const sortButton = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Sort"),
    );

    if (!(sortButton instanceof HTMLButtonElement)) {
      throw new Error("Expected sort button to render");
    }

    await act(async () => {
      sortButton.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });

    const workflowRadio = Array.from(
      document.querySelectorAll('[role="menuitemradio"]'),
    ).find((node) => node.textContent?.trim() === "Workflow");

    if (!(workflowRadio instanceof HTMLElement)) {
      throw new Error("Expected workflow sort option to render");
    }

    await act(async () => {
      workflowRadio.click();
    });

    const updater = onUpdateViewConfig.mock.calls.at(-1)?.[0];
    if (typeof updater !== "function") {
      throw new Error("Expected sort field change to submit an updater");
    }

    expect(
      updater({
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        sortBy: [
          { field: "startedAt", direction: "desc" },
          { field: "providerId", direction: "asc" },
        ],
      }).sortBy,
    ).toEqual([
      { field: "workflowName", direction: "desc" },
      { field: "providerId", direction: "asc" },
    ]);
  });

  it("updates verticalGroupBy from the swimlane control in kanban mode", async () => {
    const onUpdateViewConfig = vi.fn();

    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={DEFAULT_MONITOR_VIEW_CONFIG}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={onUpdateViewConfig}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    const swimlaneButton = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Swimlane"),
    );

    if (!(swimlaneButton instanceof HTMLButtonElement)) {
      throw new Error("Expected swimlane button to render");
    }

    await act(async () => {
      swimlaneButton.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });

    const workflowRadio = Array.from(
      document.querySelectorAll('[role="menuitemradio"]'),
    ).find((node) => node.textContent?.trim() === "Workflow");

    if (!(workflowRadio instanceof HTMLElement)) {
      throw new Error("Expected swimlane workflow option to render");
    }

    await act(async () => {
      workflowRadio.click();
    });

    const updater = onUpdateViewConfig.mock.calls.at(-1)?.[0];
    if (typeof updater !== "function") {
      throw new Error("Expected swimlane change to submit an updater");
    }

    expect(updater(DEFAULT_MONITOR_VIEW_CONFIG).verticalGroupBy).toBe(
      "workflow",
    );
  });

  it("shows GitHub-style timeline configuration controls in the view toolbar", async () => {
    await act(async () => {
      root.render(
        <MonitorExecutionWorkspace
          viewStateMode="server"
          viewStateReloading={false}
          viewsError={null}
          isCreateViewDialogOpen={false}
          effectiveConfig={{
            ...DEFAULT_MONITOR_VIEW_CONFIG,
            layout: "timeline",
            groupBy: "workflow",
            sliceBy: "trigger",
            timeline: {
              ...DEFAULT_MONITOR_VIEW_CONFIG.timeline,
              markers: {
                today: true,
                intervalBoundaries: false,
              },
              zoom: "day",
              scale: 120,
            },
          }}
          nameDialogValue=""
          nameDialogBusy={false}
          executionItems={[]}
          executionsLoading={false}
          executionsError={null}
          selectedExecutionLogId={null}
          selectedExecution={null}
          selectedExecutionLog={null}
          inspectorLoading={false}
          inspectorError={null}
          innerPanelSizes={null}
          onInnerPanelLayout={vi.fn()}
          onUpdateViewConfig={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
          onSelectExecution={vi.fn()}
          onNavigatePrev={vi.fn()}
          onNavigateNext={vi.fn()}
          hasPrev={false}
          hasNext={false}
          onChangeNameDialogValue={vi.fn()}
          onCloseNameDialog={vi.fn()}
          onSubmitNameDialog={vi.fn()}
          onReloadViews={vi.fn()}
        />,
      );
    });

    const toolbar = container.querySelector(
      '[role="toolbar"][aria-label="Monitor view controls"]',
    );
    if (!(toolbar instanceof HTMLElement)) {
      throw new Error("Expected monitor view toolbar to render");
    }

    expect(toolbar.textContent).toContain("Group by");
    expect(toolbar.textContent).toContain("Workflow");
    expect(toolbar.textContent).toContain("Markers");
    expect(toolbar.textContent).toContain("Today");
    expect(toolbar.textContent).toContain("Sort by");
    expect(toolbar.textContent).toContain("Started at");
    expect(toolbar.textContent).toContain("Dates");
    expect(toolbar.textContent).toContain("Started");
    expect(toolbar.textContent).toContain("Ended");
    expect(toolbar.textContent).not.toContain("Zoom level");
    expect(toolbar.textContent).not.toContain("120%");
    expect(toolbar.textContent).toContain("Slice by");
    expect(toolbar.textContent).toContain("Trigger");
    expect(toolbar.textContent).toContain("Field sum");
    expect(toolbar.textContent).toContain("Count");
    expect(toolbar.textContent).toContain("Timezone");
    expect(toolbar.textContent).toContain("UTC");

    const rangeControls = container.querySelector(
      '[role="menubar"][aria-label="Timeline range controls"]',
    );
    if (!(rangeControls instanceof HTMLElement)) {
      throw new Error("Expected timeline range controls to render");
    }

    expect(rangeControls.textContent).toContain("Today");
    expect(rangeControls.textContent).toContain("Day");
    expect(rangeControls.textContent).toContain("Scale");
    expect(rangeControls.textContent).toContain("120%");
    expect(rangeControls.textContent).not.toContain("Markers");
    expect(rangeControls.querySelector('[role="slider"]')).toBeTruthy();
  });
});
