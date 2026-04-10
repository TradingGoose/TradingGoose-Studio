import { describe, expect, it } from 'vitest'
import { resolveImportedWorkflowName } from '@/lib/workflows/import-export'
import { parseWorkflowJson } from './importer'

const createWorkflowState = () => ({
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
})

describe('workflow json importer', () => {
  it('parses the unified workflow export format', () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows'],
      skills: [],
      workflows: [
        {
          name: '  Primary Workflow  ',
          description: '  Workflow used for trading  ',
          color: '  #3972F6  ',
          state: createWorkflowState(),
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(errors).toEqual([])
    expect(data).not.toBeNull()
    expect(data).toMatchObject({
      name: 'Primary Workflow',
      description: 'Workflow used for trading',
      color: '#3972F6',
      state: {
        blocks: {
          block_1: {
            id: 'block_1',
          },
        },
      },
    })
  })

  it('parses the mixed workflow export format and keeps embedded skills', () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows', 'skills'],
      skills: [
        {
          name: 'Market Research',
          description: 'Investigate the market.',
          content: 'Use multiple trusted sources.',
        },
      ],
      workflows: [
        {
          name: '  Primary Workflow  ',
          description: '  Workflow used for trading  ',
          color: '  #3972F6  ',
          state: createWorkflowState(),
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(errors).toEqual([])
    expect(data).not.toBeNull()
    expect(data).toMatchObject({
      name: 'Primary Workflow',
      description: 'Workflow used for trading',
      color: '#3972F6',
      skills: [
        {
          name: 'Market Research',
          description: 'Investigate the market.',
          content: 'Use multiple trusted sources.',
        },
      ],
      state: {
        blocks: {
          block_1: {
            id: 'block_1',
          },
        },
      },
    })
  })

  it('rejects mixed workflow export files without embedded skills', () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows', 'skills'],
      workflows: [
        {
          name: 'Primary Workflow',
          description: 'Workflow used for trading',
          color: '#3972F6',
          state: createWorkflowState(),
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(data).toBeNull()
    expect(errors.some((error) => error.includes('At least one skill is required'))).toBe(true)
  })

  it('rejects mixed workflow export files with duplicate normalized skill names', () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows', 'skills'],
      skills: [
        {
          name: '  Market Research  ',
          description: 'Investigate the market.',
          content: 'Use multiple trusted sources.',
        },
        {
          name: 'Market Research',
          description: 'Investigate the market further.',
          content: 'Review catalysts.',
        },
      ],
      workflows: [
        {
          name: 'Primary Workflow',
          description: 'Workflow used for trading',
          color: '#3972F6',
          state: createWorkflowState(),
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(data).toBeNull()
    expect(errors.some((error) => error.includes('Duplicate skill name'))).toBe(true)
  })

  it('parses the legacy workflow export format with a fallback filename', () => {
    const payload = {
      version: '1.0',
      exportedAt: '2026-03-05T00:00:00.000Z',
      state: createWorkflowState(),
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false, {
      fallbackName: '  Legacy Workflow  ',
    })

    expect(errors).toEqual([])
    expect(data).not.toBeNull()
    expect(data).toMatchObject({
      name: 'Legacy Workflow',
      description: 'Workflow imported from JSON',
      color: '',
      state: {
        blocks: {
          block_1: {
            id: 'block_1',
          },
        },
      },
    })
  })

  it('rejects invalid workflow envelopes', () => {
    const payload = {
      version: '1',
      fileType: 'wrongFileType',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['skills'],
      workflows: [
        {
          name: 'Primary Workflow',
          state: createWorkflowState(),
        },
      ],
    }

    const { data, errors } = parseWorkflowJson(JSON.stringify(payload), false)

    expect(data).toBeNull()
    expect(errors[0]).toContain('Unsupported JSON format')
  })

  it('resolves imported workflow names without duplicating the imported marker', () => {
    const resolvedName = resolveImportedWorkflowName('Primary Workflow (imported)', [
      'Primary Workflow (imported)',
      'Primary Workflow (imported) 1',
    ])

    expect(resolvedName).toBe('Primary Workflow (imported) 2')
  })
})
