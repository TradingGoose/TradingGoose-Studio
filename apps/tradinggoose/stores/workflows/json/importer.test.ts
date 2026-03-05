import { describe, expect, it } from 'vitest'
import { parseWorkflowJson } from './importer'

describe('workflow json importer', () => {
  it('parses canonical versioned workflow export format', () => {
    const payload = {
      version: '1.0',
      exportedAt: '2026-03-05T00:00:00.000Z',
      state: {
        blocks: {
          block_1: {
            id: 'block_1',
            type: 'agent',
            name: 'Agent 1',
            position: { x: 0, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      },
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(errors).toEqual([])
    expect(data).not.toBeNull()
    expect(data?.blocks.block_1).toBeDefined()
    expect(data?.edges).toEqual([])
  })

  it('rejects legacy root-level workflow payloads', () => {
    const legacyPayload = {
      blocks: {
        block_1: {
          id: 'block_1',
          type: 'agent',
          name: 'Agent 1',
          position: { x: 0, y: 0 },
        },
      },
      edges: [],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(legacyPayload), false)

    expect(data).toBeNull()
    expect(errors).toContain(
      'Unsupported JSON format: expected a versioned workflow export with `version` and `state` fields'
    )
  })

  it('rejects version payloads with invalid state shape', () => {
    const invalidPayload = {
      version: '1.0',
      state: null,
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(invalidPayload), false)

    expect(data).toBeNull()
    expect(errors).toContain(
      'Unsupported JSON format: expected a versioned workflow export with `version` and `state` fields'
    )
  })
})
