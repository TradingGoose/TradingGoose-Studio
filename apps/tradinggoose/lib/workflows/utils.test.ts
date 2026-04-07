import { describe, expect, it } from 'vitest'
import { hasWorkflowChanged } from '@/lib/workflows/utils'

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
