import { describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({
  db: {},
}))

vi.mock('@tradinggoose/db/schema', () => ({
  apiKey: {},
  permissions: {},
  workflow: {},
  workspace: {},
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost'),
}))

import { hasWorkflowChanged, workflowHasResponseBlock } from '@/lib/workflows/utils'

const baseState = {
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
}

describe('hasWorkflowChanged', () => {
  it('detects variable-only workflow changes', () => {
    const deployedState = {
      ...baseState,
      variables: {
        first: {
          id: 'var-1',
          name: 'region',
          type: 'plain',
          value: 'us-east-1',
        },
      },
    }

    const currentState = {
      ...baseState,
      variables: {
        first: {
          id: 'var-1',
          name: 'region',
          type: 'plain',
          value: 'us-west-2',
        },
      },
    }

    expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
  })

  it('ignores equivalent variable payloads', () => {
    const deployedState = {
      ...baseState,
      variables: {
        first: {
          id: 'var-1',
          name: 'region',
          config: {
            default: 'us-east-1',
            editable: true,
          },
        },
      },
    }

    const currentState = {
      ...baseState,
      variables: {
        first: {
          config: {
            editable: true,
            default: 'us-east-1',
          },
          name: 'region',
          id: 'var-1',
        },
      },
    }

    expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(false)
  })
})

describe('workflowHasResponseBlock', () => {
  it('requires a completed response block instead of only output.response', () => {
    const output = { response: { data: { ok: true }, status: 200, headers: {} } }

    expect(
      workflowHasResponseBlock({
        success: true,
        output,
        logs: [],
      })
    ).toBe(false)

    expect(
      workflowHasResponseBlock({
        success: true,
        output,
        logs: [{ blockId: 'response-1', blockType: 'response', success: true } as any],
      })
    ).toBe(true)

    expect(
      workflowHasResponseBlock({
        success: true,
        output,
        logs: [],
        metadata: { duration: 1, hasResponseBlock: true },
      })
    ).toBe(true)
  })
})
