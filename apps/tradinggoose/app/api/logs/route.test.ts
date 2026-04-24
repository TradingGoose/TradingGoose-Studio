/**
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockOrderBy,
  mockWhere,
  mockInnerJoin,
  mockLeftJoin,
  mockFrom,
  mockSelect,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn();
  const mockOrderBy = vi.fn();
  const chain: Record<string, any> = {};
  const mockWhere = vi.fn(() => chain);
  const mockInnerJoin = vi.fn(() => chain);
  const mockLeftJoin = vi.fn(() => chain);
  const mockFrom = vi.fn(() => chain);
  Object.assign(chain, {
    innerJoin: mockInnerJoin,
    leftJoin: mockLeftJoin,
    where: mockWhere,
    orderBy: mockOrderBy,
  });
  const mockSelect = vi.fn(() => ({
    from: mockFrom,
  }));

  return {
    mockGetSession,
    mockOrderBy,
    mockWhere,
    mockInnerJoin,
    mockLeftJoin,
    mockFrom,
    mockSelect,
  };
});

vi.mock("@tradinggoose/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@tradinggoose/db/schema", () => ({
  permissions: {
    entityType: "permissions.entityType",
    entityId: "permissions.entityId",
    userId: "permissions.userId",
  },
  workflow: {
    id: "workflow.id",
    workspaceId: "workflow.workspaceId",
    name: "workflow.name",
    description: "workflow.description",
    color: "workflow.color",
    folderId: "workflow.folderId",
    userId: "workflow.userId",
    createdAt: "workflow.createdAt",
    updatedAt: "workflow.updatedAt",
  },
  workflowExecutionLogs: {
    id: "workflowExecutionLogs.id",
    workflowId: "workflowExecutionLogs.workflowId",
    executionId: "workflowExecutionLogs.executionId",
    level: "workflowExecutionLogs.level",
    trigger: "workflowExecutionLogs.trigger",
    startedAt: "workflowExecutionLogs.startedAt",
    endedAt: "workflowExecutionLogs.endedAt",
    totalDurationMs: "workflowExecutionLogs.totalDurationMs",
    executionData: "workflowExecutionLogs.executionData",
    cost: "workflowExecutionLogs.cost",
    files: "workflowExecutionLogs.files",
    createdAt: "workflowExecutionLogs.createdAt",
  },
  workflowFolder: {
    id: "workflowFolder.id",
    name: "workflowFolder.name",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
  desc: vi.fn((value: unknown) => ({ type: "desc", value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: "eq", value })),
  gte: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: "gte",
    value,
  })),
  inArray: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: "inArray",
    value,
  })),
  lte: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: "lte",
    value,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    type: "sql",
  })),
}));

vi.mock("@/lib/auth", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const buildRow = ({
  id,
  folderName,
  workflowName,
  providerId = "alpaca",
  startedAt = new Date("2026-04-23T00:00:00.000Z"),
}: {
  id: string;
  folderName: string;
  workflowName: string;
  providerId?: string;
  startedAt?: Date | null;
}) => ({
  id,
  workflowId: "workflow-1",
  executionId: `exec-${id}`,
  level: "info",
  trigger: "manual",
  startedAt,
  endedAt: new Date("2026-04-23T00:05:00.000Z"),
  totalDurationMs: 300000,
  executionData: {
    blockExecutions: [
      {
        id: `block-execution-${id}`,
        blockId: `block-${id}`,
        blockName: `Block ${id}`,
        blockType: "http",
        startedAt: "2026-04-23T00:00:00.000Z",
        endedAt: "2026-04-23T00:05:00.000Z",
        durationMs: 300000,
        status: "success",
        inputData: { symbol: "AAPL" },
        outputData: { rows: 42 },
        metadata: {},
      },
    ],
    trigger: {
      data: {
        monitor: {
          id: `monitor-${id}`,
          providerId,
          interval: "1m",
          indicatorId: "rsi",
          listing: { listing_type: "default", listing_id: "AAPL" },
        },
      },
    },
  },
  cost: null,
  files: null,
  createdAt: new Date("2026-04-23T00:00:00.000Z"),
  workflowName,
  workflowDescription: null,
  workflowColor: "#3972F6",
  workflowFolderId: `folder-${id}`,
  workflowFolderName: folderName,
  workflowUserId: "user-1",
  workflowWorkspaceId: "workspace-1",
  workflowCreatedAt: new Date("2026-04-22T00:00:00.000Z"),
  workflowUpdatedAt: new Date("2026-04-23T00:00:00.000Z"),
});

const collectConditions = (value: unknown): Array<Record<string, any>> => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const condition = value as Record<string, any>;
  const nested =
    condition.type === "and" && Array.isArray(condition.conditions)
      ? condition.conditions.flatMap((entry: unknown) =>
          collectConditions(entry),
        )
      : [];

  return [condition, ...nested];
};

const expectWorkflowJoinedBeforeFolder = () => {
  const fromCall = mockFrom.mock.calls.at(-1) as [unknown] | undefined;

  expect(fromCall?.[0]).toMatchObject({
    id: "workflow.id",
  });
  expect(mockInnerJoin.mock.invocationCallOrder[0]).toBeLessThan(
    mockLeftJoin.mock.invocationCallOrder[0]!,
  );
};

describe("logs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    mockOrderBy.mockResolvedValue([
      buildRow({
        id: "log-1",
        folderName: "Alpha Desk",
        workflowName: "Workflow Alpha",
      }),
      buildRow({
        id: "log-2",
        folderName: "Beta Desk",
        workflowName: "Workflow Beta",
      }),
    ]);
  });

  it("rejects unauthorized access", async () => {
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/logs?workspaceId=workspace-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("filters logs by folder name", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&folderName=Alpha",
      ),
    );

    expect(response.status).toBe(200);
    expectWorkflowJoinedBeforeFolder();
    expect(
      (await response.json()).data.map((entry: { id: string }) => entry.id),
    ).toEqual(["log-1"]);
  });

  it("treats text-mode workflow and folder filters as OR lists", async () => {
    const { GET } = await import("./route");
    const workflowResponse = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&workflowName=Workflow%20Alpha,Missing%20Workflow",
      ),
    );
    const folderResponse = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&folderName=Missing%20Desk,Alpha%20Desk",
      ),
    );

    expect(workflowResponse.status).toBe(200);
    expect(
      (await workflowResponse.json()).data.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["log-1"]);

    expect(folderResponse.status).toBe(200);
    expect(
      (await folderResponse.json()).data.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["log-1"]);
  });

  it("excludes logs by folder name", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&excludeFolderName=Alpha",
      ),
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).data.map((entry: { id: string }) => entry.id),
    ).toEqual(["log-2"]);
  });

  it("filters basic-detail responses by monitor snapshot fields before trimming execution data", async () => {
    mockOrderBy.mockResolvedValue([
      buildRow({
        id: "log-1",
        folderName: "Alpha Desk",
        workflowName: "Workflow Alpha",
        providerId: "alpaca",
      }),
      buildRow({
        id: "log-2",
        folderName: "Beta Desk",
        workflowName: "Workflow Beta",
        providerId: "binance",
      }),
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&details=basic&providerId=alpaca",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((entry: { id: string }) => entry.id)).toEqual([
      "log-1",
    ]);
    expect(body.data[0]?.executionData).toBeUndefined();
  });

  it("serializes full-detail responses without createdAt and synthesizes trace spans", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&details=full&providerId=alpaca",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: "log-1",
        durationMs: 300000,
        executionData: expect.objectContaining({
          traceSpans: [
            expect.objectContaining({
              id: "block-execution-log-1",
              blockId: "block-log-1",
              name: "Block log-1",
            }),
          ],
        }),
      }),
    );
    expect(body.data[0]?.createdAt).toBeUndefined();
  });

  it("fails instead of falling back to createdAt when startedAt is missing", async () => {
    mockOrderBy.mockResolvedValue([
      buildRow({
        id: "log-1",
        folderName: "Alpha Desk",
        workflowName: "Workflow Alpha",
        startedAt: null,
      }),
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/logs?workspaceId=workspace-1"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Workflow log log-1 is missing startedAt",
    });
  });

  it("pushes range-bound qualifiers into the SQL condition tree before in-memory filtering", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs?workspaceId=workspace-1&startedAtFrom=2026-04-20T00:00:00.000Z&startedAtFromExclusive=true&endedAtTo=2026-04-24T00:00:00.000Z&durationMinMs=1000&costMax=1.5",
      ),
    );

    expect(response.status).toBe(200);

    const whereCall = mockWhere.mock.calls.at(-1) as [unknown] | undefined;
    const conditions = collectConditions(whereCall?.[0]);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "sql" &&
          condition.values?.includes("workflowExecutionLogs.startedAt") &&
          condition.values?.some(
            (value: unknown) =>
              value instanceof Date &&
              value.toISOString() === "2026-04-20T00:00:00.000Z",
          ),
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "lte" &&
          condition.field === "workflowExecutionLogs.endedAt" &&
          condition.value instanceof Date &&
          condition.value.toISOString() === "2026-04-24T00:00:00.000Z",
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "gte" &&
          condition.field === "workflowExecutionLogs.totalDurationMs" &&
          condition.value === 1000,
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "sql" &&
          condition.values?.includes(1.5) &&
          condition.strings?.join("").includes("<="),
      ),
    ).toBe(true);
  });
});
