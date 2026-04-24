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
  startedAt = new Date("2026-04-23T00:00:00.000Z"),
}: {
  id: string;
  folderName: string;
  workflowName: string;
  startedAt?: Date;
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
    trigger: {
      data: {
        monitor: {
          id: `monitor-${id}`,
          providerId: "alpaca",
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

describe("logs export route", () => {
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
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1",
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("exports only logs that match the requested folder name", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&folderName=Alpha",
      ),
    );

    expect(response.status).toBe(200);
    expectWorkflowJoinedBeforeFolder();
    const body = await response.text();
    expect(body).toContain("Workflow Alpha");
    expect(body).not.toContain("Workflow Beta");
  });

  it("treats text-mode workflow and folder filters as OR lists during export", async () => {
    const { GET } = await import("./route");
    const workflowResponse = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&workflowName=Workflow%20Alpha,Missing%20Workflow",
      ),
    );
    const folderResponse = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&folderName=Missing%20Desk,Alpha%20Desk",
      ),
    );

    expect(workflowResponse.status).toBe(200);
    expect(await workflowResponse.text()).toContain("Workflow Alpha");
    expect(await folderResponse.text()).toContain("Workflow Alpha");
  });

  it("exports only logs that survive folder exclusions", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&excludeFolderName=Alpha",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Workflow Beta");
    expect(body).not.toContain("Workflow Alpha");
  });

  it("respects explicit start-date windows during export", async () => {
    mockOrderBy.mockResolvedValue([
      buildRow({
        id: "log-1",
        folderName: "Alpha Desk",
        workflowName: "Workflow Alpha",
        startedAt: new Date("2026-04-23T00:00:00.000Z"),
      }),
      buildRow({
        id: "log-2",
        folderName: "Beta Desk",
        workflowName: "Workflow Beta",
        startedAt: new Date("2026-04-20T00:00:00.000Z"),
      }),
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&startDate=2026-04-22T00:00:00.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(mockWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "and",
        conditions: expect.arrayContaining([
          expect.objectContaining({
            type: "gte",
            field: "workflowExecutionLogs.startedAt",
            value: new Date("2026-04-22T00:00:00.000Z"),
          }),
        ]),
      }),
    );
  });

  it("pushes range-bound export qualifiers into the SQL condition tree", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/logs/export?workspaceId=workspace-1&startedAtTo=2026-04-24T00:00:00.000Z&endedAtFrom=2026-04-20T00:00:00.000Z&durationMaxMs=5000&costMin=0.25&costMinExclusive=true",
      ),
    );

    expect(response.status).toBe(200);

    const whereCall = mockWhere.mock.calls.at(-1) as [unknown] | undefined;
    const conditions = collectConditions(whereCall?.[0]);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "lte" &&
          condition.field === "workflowExecutionLogs.startedAt" &&
          condition.value instanceof Date &&
          condition.value.toISOString() === "2026-04-24T00:00:00.000Z",
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "gte" &&
          condition.field === "workflowExecutionLogs.endedAt" &&
          condition.value instanceof Date &&
          condition.value.toISOString() === "2026-04-20T00:00:00.000Z",
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "lte" &&
          condition.field === "workflowExecutionLogs.totalDurationMs" &&
          condition.value === 5000,
      ),
    ).toBe(true);

    expect(
      conditions.some(
        (condition) =>
          condition.type === "sql" &&
          condition.values?.includes(0.25) &&
          condition.strings?.join("").includes(">"),
      ),
    ).toBe(true);
  });
});
