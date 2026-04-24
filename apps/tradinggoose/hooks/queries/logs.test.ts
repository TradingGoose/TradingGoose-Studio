import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLogsRequestParams } from "./logs";

describe("buildLogsRequestParams", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps export query params aligned with the live logs time-range filter", () => {
    const queryString = buildLogsRequestParams(
      "workspace-1",
      {
        timeRange: "Past 24 hours",
        level: "all",
        workflowIds: ["workflow-1"],
        folderIds: ["folder-1"],
        triggers: ["manual"],
        searchQuery: "workflow:#wf-1 needs-review",
        limit: 50,
      },
      {
        includePagination: false,
        includeDetails: false,
      },
    );

    const params = new URLSearchParams(queryString);

    expect(params.get("workspaceId")).toBe("workspace-1");
    expect(params.get("startDate")).toBe("2026-04-22T12:00:00.000Z");
    expect(params.get("workflowIds")).toBe("workflow-1,wf-1");
    expect(params.get("folderIds")).toBe("folder-1");
    expect(params.get("triggers")).toBe("manual");
    expect(params.get("search")).toBe("needs-review");
    expect(params.get("limit")).toBeNull();
    expect(params.get("offset")).toBeNull();
    expect(params.get("details")).toBeNull();
  });

  it("merges explicit sidebar filters with parsed query filters instead of overwriting them", () => {
    const queryString = buildLogsRequestParams("workspace-1", {
      timeRange: "All time",
      level: "all",
      workflowIds: ["workflow-1"],
      folderIds: [],
      triggers: ["manual"],
      searchQuery: "workflow:#wf-2 trigger:api needs-review",
      limit: 50,
    });

    const params = new URLSearchParams(queryString);

    expect(params.get("workflowIds")).toBe("workflow-1,wf-2");
    expect(params.get("triggers")).toBe("manual,api");
    expect(params.get("search")).toBe("needs-review");
  });

  it("serializes explicit listing filters through the canonical listings param", () => {
    const queryString = buildLogsRequestParams("workspace-1", {
      timeRange: "All time",
      level: "all",
      workflowIds: [],
      folderIds: [],
      triggers: [],
      searchQuery: "",
      limit: 50,
      listings: [
        {
          listing_id: "AAPL",
          base_id: "",
          quote_id: "",
          listing_type: "default",
        },
      ],
    });

    const params = new URLSearchParams(queryString);

    expect(params.get("listing")).toBeNull();
    expect(params.get("listings")).toBe(
      JSON.stringify([
        {
          listing_id: "AAPL",
          base_id: "",
          quote_id: "",
          listing_type: "default",
        },
      ]),
    );
  });
});
