/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIndicatorMonitor,
  createMonitorView,
  deleteIndicatorMonitor,
  loadMonitors,
  loadWorkflowOptions,
  removeMonitorView,
  setActiveMonitorView,
  updateIndicatorMonitor,
  updateMonitorView,
} from "@/app/workspace/[workspaceId]/monitor/components/data/api";
import { bootstrapMonitorViews } from "@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap";
import { MonitorPage } from "./monitor";
import {
  DEFAULT_MONITOR_VIEW_CONFIG,
  type MonitorViewRow,
} from "./components/view/view-config";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

vi.mock("@/global-navbar", () => ({
  GlobalNavbarHeader: ({
    left,
    center,
    right,
  }: {
    left?: ReactNode;
    center?: ReactNode;
    right?: ReactNode;
  }) => (
    <div>
      <div>{left}</div>
      <div>{center}</div>
      <div>{right}</div>
    </div>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/workspace-1/monitor",
}));

vi.mock("@/app/workspace/[workspaceId]/dashboard/layout-tabs", () => ({
  LayoutTabs: ({
    layouts,
    onCreate,
    onSelect,
    onDelete,
  }: {
    layouts: Array<{ id: string; name: string; isActive: boolean }>;
    onCreate: () => void;
    onSelect: (layoutId: string) => void;
    onDelete?: (layoutId: string) => void;
  }) => (
    <div>
      <button type="button" onClick={onCreate}>
        Create view
      </button>
      {layouts.map((layout) => (
        <div key={layout.id}>
          <button type="button" onClick={() => onSelect(layout.id)}>
            {layout.name}
          </button>
          {!layout.isActive && onDelete ? (
            <button type="button" onClick={() => onDelete(layout.id)}>
              Delete {layout.name}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/app/workspace/[workspaceId]/logs/components/logs-toolbar", () => ({
  AutocompleteSearch: ({
    value,
    workflowsData = [],
    foldersData = [],
    externalClauses = [],
    onRemoveExternalClause,
  }: {
    value: string;
    workflowsData?: Array<{ id: string; name: string }>;
    foldersData?: Array<{ id: string; name: string }>;
    externalClauses?: Array<{ id: string; raw: string }>;
    onRemoveExternalClause?: (clause: { id: string; raw: string }) => void;
  }) => (
    <div>
      <div data-testid="autocomplete-value">{value}</div>
      <div data-testid="autocomplete-workflow-count">
        {workflowsData.length}
      </div>
      <div data-testid="autocomplete-folder-count">{foldersData.length}</div>
      <div data-testid="autocomplete-external">
        {externalClauses.map((clause) => clause.raw).join("|")}
      </div>
      {externalClauses.map((clause) => (
        <button
          key={clause.id}
          type="button"
          onClick={() => onRemoveExternalClause?.(clause)}
        >
          Remove {clause.raw}
        </button>
      ))}
    </div>
  ),
}));

vi.mock(
  "@/app/workspace/[workspaceId]/monitor/components/management/monitor-management-pane",
  () => ({
    MonitorManagementPane: (props: any) => (
      <div>
        <button
          type="button"
          onClick={() =>
            props.onCreateMonitor({
              workspaceId: "workspace-1",
              workflowId: "workflow-1",
              blockId: "block-1",
              providerId: "alpaca",
              interval: "1m",
              indicatorId: "rsi",
              listing: { listing_type: "default", listing_id: "AAPL" },
              auth: { secrets: {} },
              isActive: true,
            })
          }
        >
          Create monitor
        </button>
        <button
          type="button"
          onClick={() =>
            props.onToggleMonitorState(
              {
                monitorId: "monitor-1",
              },
              false,
            )
          }
        >
          Toggle monitor
        </button>
        <button
          type="button"
          onClick={() => props.onDeleteMonitor("monitor-1")}
        >
          Delete monitor
        </button>
      </div>
    ),
  }),
);

vi.mock(
  "@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-execution-workspace",
  () => ({
    MonitorExecutionWorkspace: (props: any) => (
      <div>
        <div data-testid="selected-execution">
          {props.selectedExecutionLogId ?? "none"}
        </div>
        <div data-testid="views-error">{props.viewsError ?? "none"}</div>
        <div data-testid="name-dialog-mode">
          {props.isCreateViewDialogOpen ? "create" : "none"}
        </div>
        <button
          type="button"
          onClick={() =>
            props.onUpdateViewConfig(
              (current: typeof DEFAULT_MONITOR_VIEW_CONFIG) => ({
                ...current,
                filterQuery: "status:success",
              }),
            )
          }
        >
          Change view
        </button>
        <button type="button" onClick={() => props.onSelectExecution("log-1")}>
          Select execution
        </button>
        <button
          type="button"
          onClick={() => props.onToggleQuickFilter("provider", "alpaca")}
        >
          Toggle provider filter
        </button>
        <button type="button" onClick={() => props.onSubmitNameDialog()}>
          Submit name dialog
        </button>
      </div>
    ),
  }),
);

vi.mock(
  "@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs")
      >();

    return {
      ...actual,
      useMonitorWorkspaceLogs: () => ({
        executionItems: [
          {
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
            sourceLog: { id: "log-1" },
          },
        ],
        orderedVisibleLogIds: ["log-1"],
        isSelectionResolved: true,
        isLoading: false,
        isFetching: false,
        error: null,
        refresh: vi.fn(),
      }),
    };
  },
);

vi.mock("@/hooks/queries/logs", () => ({
  useLogDetail: () => ({ data: null, isLoading: false, error: null }),
}));

vi.mock("@/app/workspace/[workspaceId]/monitor/components/data/api", () => ({
  createMonitorView: vi.fn(),
  createIndicatorMonitor: vi.fn(),
  deleteIndicatorMonitor: vi.fn(),
  listMonitorViews: vi.fn(),
  loadIndicatorOptions: vi.fn().mockResolvedValue([]),
  loadMonitors: vi.fn().mockResolvedValue([]),
  loadWorkflowOptions: vi.fn().mockResolvedValue([]),
  loadWorkflowTargetOptions: vi.fn().mockResolvedValue([]),
  removeMonitorView: vi.fn(),
  reorderMonitorViews: vi.fn(),
  setActiveMonitorView: vi.fn(),
  updateIndicatorMonitor: vi.fn(),
  updateMonitorView: vi.fn(),
}));

vi.mock(
  "@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap",
  () => ({
    bootstrapMonitorViews: vi.fn(),
  }),
);

const mockedBootstrapMonitorViews = vi.mocked(bootstrapMonitorViews);
const mockedCreateIndicatorMonitor = vi.mocked(createIndicatorMonitor);
const mockedCreateMonitorView = vi.mocked(createMonitorView);
const mockedDeleteIndicatorMonitor = vi.mocked(deleteIndicatorMonitor);
const mockedLoadMonitors = vi.mocked(loadMonitors);
const mockedLoadWorkflowOptions = vi.mocked(loadWorkflowOptions);
const mockedUpdateMonitorView = vi.mocked(updateMonitorView);
const mockedUpdateIndicatorMonitor = vi.mocked(updateIndicatorMonitor);
const mockedRemoveMonitorView = vi.mocked(removeMonitorView);
const mockedSetActiveMonitorView = vi.mocked(setActiveMonitorView);

const buildViewRow = ({
  id,
  name,
  isActive,
  config = DEFAULT_MONITOR_VIEW_CONFIG,
}: {
  id: string;
  name: string;
  isActive: boolean;
  config?: typeof DEFAULT_MONITOR_VIEW_CONFIG;
}): MonitorViewRow => ({
  id,
  name,
  sortOrder: isActive ? 0 : 1,
  isActive,
  config,
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
});

const buildMonitorRow = (monitorId: string) => ({
  monitorId,
  workflowId: "workflow-1",
  blockId: "block-1",
  isActive: true,
  providerConfig: {
    triggerId: "indicator_trigger" as const,
    version: 1 as const,
    monitor: {
      providerId: "alpaca",
      interval: "1m",
      listing: { listing_type: "default" as const, listing_id: "AAPL" },
      indicatorId: "rsi",
    },
  },
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
});

describe("MonitorPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
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
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: "server",
      viewRows: [
        buildViewRow({
          id: "view-1",
          name: "Current View",
          isActive: true,
          config: { ...DEFAULT_MONITOR_VIEW_CONFIG, layout: "timeline" },
        }),
      ],
      activeViewId: "view-1",
      viewConfig: { ...DEFAULT_MONITOR_VIEW_CONFIG, layout: "timeline" },
      viewsError: null,
    });
    mockedCreateMonitorView.mockResolvedValue(
      buildViewRow({
        id: "view-2",
        name: "View 1",
        isActive: true,
        config: { ...DEFAULT_MONITOR_VIEW_CONFIG, layout: "timeline" },
      }),
    );
    mockedCreateIndicatorMonitor.mockResolvedValue(
      buildMonitorRow("monitor-created") as any,
    );
    mockedUpdateIndicatorMonitor.mockResolvedValue(
      buildMonitorRow("monitor-1") as any,
    );
    mockedDeleteIndicatorMonitor.mockResolvedValue(undefined);
    mockedLoadMonitors.mockResolvedValue([]);
    mockedLoadWorkflowOptions.mockResolvedValue([]);
    mockedUpdateMonitorView.mockResolvedValue(undefined);
    mockedRemoveMonitorView.mockResolvedValue(undefined);
    mockedSetActiveMonitorView.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
  });

  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes(label),
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Expected button "${label}" to render`);
    }

    await act(async () => {
      button.click();
    });
  };

  const selectedExecution = () =>
    container.querySelector('[data-testid="selected-execution"]')?.textContent;

  const autocompleteValue = () =>
    container.querySelector('[data-testid="autocomplete-value"]')?.textContent;

  const waitForText = async (text: string) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (container.textContent?.includes(text)) {
        return;
      }

      await act(async () => {
        await Promise.resolve();
      });
    }

    throw new Error(`Expected "${text}" to appear in the rendered output`);
  };

  it("creates a new view from the current effective config through the name dialog flow", async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    await click("Create view");
    expect(
      container.querySelector('[data-testid="name-dialog-mode"]')?.textContent,
    ).toBe("create");

    await click("Submit name dialog");

    expect(mockedCreateMonitorView).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        name: "View 1",
        config: expect.objectContaining({ layout: "timeline" }),
      }),
    );
  });

  it("updates the active view locally and persists it before refreshing", async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    await click("Change view");
    expect(autocompleteValue()).toBe("status:success");
    expect(mockedUpdateMonitorView).not.toHaveBeenCalled();

    await click("Refresh monitor workspace");
    expect(mockedUpdateMonitorView).toHaveBeenCalledWith(
      "workspace-1",
      "view-1",
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: "status:success",
        }),
      }),
    );
  });

  it("does not pass folder suggestions into the monitor header search", async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    expect(
      container.querySelector('[data-testid="autocomplete-folder-count"]')
        ?.textContent,
    ).toBe("0");
  });

  it("passes workspace-loaded workflow suggestions into the monitor header search", async () => {
    mockedLoadWorkflowOptions.mockResolvedValue([
      {
        workflowId: "workflow-1",
        workflowName: "Workflow One",
        workflowColor: "#3972F6",
      },
    ]);

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    expect(
      container.querySelector('[data-testid="autocomplete-workflow-count"]')
        ?.textContent,
    ).toBe("1");
  });

  it("shows quick filters alongside the shared header query and removes them from that surface", async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: "server",
      viewRows: [
        buildViewRow({ id: "view-1", name: "Current View", isActive: true }),
      ],
      activeViewId: "view-1",
      viewConfig: {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        quickFilters: [
          { field: "provider", operator: "include", values: ["alpaca"] },
        ],
      },
      viewsError: null,
    });

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    expect(autocompleteValue()).toBe("");
    expect(
      container.querySelector('[data-testid="autocomplete-external"]')
        ?.textContent,
    ).toContain("provider:#alpaca");

    await click("Remove provider:#alpaca");
    expect(
      container.querySelector('[data-testid="autocomplete-external"]')
        ?.textContent,
    ).not.toContain("provider:#alpaca");
  });

  it("removes a committed header query clause when the canvas toggles the same filter", async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: "server",
      viewRows: [
        buildViewRow({ id: "view-1", name: "Current View", isActive: true }),
      ],
      activeViewId: "view-1",
      viewConfig: {
        ...DEFAULT_MONITOR_VIEW_CONFIG,
        filterQuery: "provider:#alpaca",
      },
      viewsError: null,
    });

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    expect(autocompleteValue()).toBe("provider:#alpaca");

    await click("Toggle provider filter");

    expect(autocompleteValue()).toBe("");
  });

  it("clears execution selection when switching saved views", async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: "server",
      viewRows: [
        buildViewRow({ id: "view-1", name: "Current View", isActive: true }),
        buildViewRow({ id: "view-2", name: "Second View", isActive: false }),
      ],
      activeViewId: "view-1",
      viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
      viewsError: null,
    });

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });
    await waitForText("Second View");
    await click("Current View");

    await click("Select execution");
    expect(selectedExecution()).toBe("log-1");

    await click("Second View");
    expect(mockedSetActiveMonitorView).toHaveBeenCalledWith(
      "workspace-1",
      "view-2",
    );
    expect(selectedExecution()).toBe("none");
  });

  it("deletes inactive views through the header tabs", async () => {
    mockedBootstrapMonitorViews.mockResolvedValue({
      viewStateMode: "server",
      viewRows: [
        buildViewRow({ id: "view-1", name: "Current View", isActive: true }),
        buildViewRow({ id: "view-2", name: "Second View", isActive: false }),
      ],
      activeViewId: "view-1",
      viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
      viewsError: null,
    });

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });
    await waitForText("Second View");

    await click("Select execution");
    expect(selectedExecution()).toBe("log-1");

    await click("Delete Second View");

    expect(mockedRemoveMonitorView).toHaveBeenCalledWith(
      "workspace-1",
      "view-2",
    );
    expect(selectedExecution()).toBe("log-1");
  });

  it("routes monitor CRUD mutations through the page-level callbacks", async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    await click("Create monitor");
    expect(mockedCreateIndicatorMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
      }),
    );

    await click("Toggle monitor");
    expect(mockedUpdateIndicatorMonitor).toHaveBeenCalledWith(
      "monitor-1",
      expect.objectContaining({
        workspaceId: "workspace-1",
        isActive: false,
      }),
    );

    await click("Delete monitor");
    expect(mockedDeleteIndicatorMonitor).toHaveBeenCalledWith("monitor-1");
  });

  it("refreshes the full monitor workspace from the page shell", async () => {
    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    expect(mockedBootstrapMonitorViews).toHaveBeenCalledTimes(1);
    expect(mockedLoadMonitors).toHaveBeenCalledTimes(1);
    expect(mockedLoadWorkflowOptions).toHaveBeenCalledTimes(1);

    await click("Refresh monitor workspace");

    expect(mockedBootstrapMonitorViews).toHaveBeenCalledTimes(2);
    expect(mockedLoadMonitors).toHaveBeenCalledTimes(2);
    expect(mockedLoadWorkflowOptions).toHaveBeenCalledTimes(2);
  });

  it("keeps the current shell state when a non-initial view reload fails", async () => {
    mockedBootstrapMonitorViews
      .mockResolvedValueOnce({
        viewStateMode: "server",
        viewRows: [
          buildViewRow({ id: "view-1", name: "Current View", isActive: true }),
        ],
        activeViewId: "view-1",
        viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
        viewsError: null,
      })
      .mockResolvedValueOnce({
        viewStateMode: "error",
        viewRows: [],
        activeViewId: null,
        viewConfig: DEFAULT_MONITOR_VIEW_CONFIG,
        viewsError: "Failed to refresh views",
      });

    await act(async () => {
      root.render(<MonitorPage workspaceId="workspace-1" userId="user-1" />);
    });

    await click("Select execution");
    expect(selectedExecution()).toBe("log-1");

    await click("Refresh monitor workspace");

    expect(selectedExecution()).toBe("log-1");
    expect(container.textContent).toContain("Current View");
    expect(container.textContent).not.toContain("Views unavailable");
    expect(
      container.querySelector('[data-testid="views-error"]')?.textContent,
    ).toBe("Failed to refresh views");
  });
});
