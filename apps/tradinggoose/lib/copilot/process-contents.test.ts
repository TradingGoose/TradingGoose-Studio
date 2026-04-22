/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetBlocksMetadataExecute = vi.fn()
const mockLoadSkill = vi.fn()
const mockLoadWorkflowStateWithFallback = vi.fn()
const mockSanitizeForCopilot = vi.fn((value) => value)

vi.mock('@tradinggoose/db', () => ({
  db: {},
}))

vi.mock('@tradinggoose/db/schema', () => ({
  copilotReviewItems: {},
  copilotReviewSessions: {},
  document: {},
  knowledgeBase: {},
  templates: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool', () => ({
  getBlocksMetadataServerTool: {
    execute: mockGetBlocksMetadataExecute,
  },
}))

vi.mock('@/lib/copilot/review-sessions/entity-loaders', () => ({
  loadSkill: mockLoadSkill,
  loadIndicator: vi.fn(),
  loadCustomTool: vi.fn(),
  loadMcpServer: vi.fn(),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadWorkflowStateWithFallback: mockLoadWorkflowStateWithFallback,
}))

vi.mock('@/lib/workflows/json-sanitizer', () => ({
  sanitizeForCopilot: mockSanitizeForCopilot,
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockLoadSkill.mockReset()
    mockLoadWorkflowStateWithFallback.mockReset()
    mockSanitizeForCopilot.mockClear()
  })

  it('expands block contexts through the canonical blockIds path', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: {
        'block-1': {
          blockType: 'block-1',
          blockName: 'RSI',
          blockDescription: 'Relative Strength Index',
        },
      },
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'blocks', blockIds: ['block-1'], label: 'RSI' }],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledWith({ blockIds: ['block-1'] })
    expect(result).toEqual([
      {
        type: 'blocks',
        tag: '@RSI',
        content: JSON.stringify({
          metadata: {
            'block-1': {
              blockType: 'block-1',
              blockName: 'RSI',
              blockDescription: 'Relative Strength Index',
            },
          },
        }),
      },
    ])
  })

  it('hydrates current entity contexts from the canonical entity loader', async () => {
    mockLoadSkill.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'Canonical Skill',
      description: 'Canonical description',
      content: 'Canonical content',
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_skill',
          label: 'Current Skill',
          workspaceId: 'workspace-1',
          skillId: 'skill-1',
        },
      ],
      'user-1'
    )

    expect(mockLoadSkill).toHaveBeenCalledWith('skill-1', 'workspace-1')
    expect(result).toEqual([
      {
        type: 'current_skill',
        tag: '@Current Skill',
        content: JSON.stringify(
          {
            id: 'skill-1',
            workspaceId: 'workspace-1',
            name: 'Canonical Skill',
            description: 'Canonical description',
            content: 'Canonical content',
          },
          null,
          2
        ),
      },
    ])
  })

  it('hydrates workflow contexts through the shared workspace entity path', async () => {
    mockLoadWorkflowStateWithFallback.mockResolvedValue({
      source: 'db',
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'trigger',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          label: 'Attached Workflow',
        },
      ],
      'user-1'
    )

    expect(mockLoadWorkflowStateWithFallback).toHaveBeenCalledWith('workflow-1')
    expect(mockSanitizeForCopilot).toHaveBeenCalledWith({
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'trigger',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    expect(result).toEqual([
      {
        type: 'workflow',
        tag: '@Attached Workflow',
        content: JSON.stringify(
          {
            blocks: {
              trigger: {
                id: 'trigger',
                type: 'trigger',
              },
            },
            edges: [],
            loops: {},
            parallels: {},
          },
          null,
          2
        ),
      },
    ])
  })
})
