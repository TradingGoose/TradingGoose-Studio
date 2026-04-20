import { describe, expect, it } from 'vitest'
import {
  createWorkflowExportFile,
  parseImportedWorkflowFile,
  resolveImportedWorkflowName,
} from '@/lib/workflows/import-export'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const createWorkflowState = (): WorkflowState => ({
  blocks: {
    block_1: {
      id: 'block_1',
      type: 'agent',
      name: 'Workflow Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        apiKey: {
          id: 'apiKey',
          type: 'text',
          value: 'secret-value',
        },
      },
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
})

const createWorkflowStateWithSkills = (): WorkflowState => ({
  blocks: {
    block_1: {
      id: 'block_1',
      type: 'agent',
      name: 'Workflow Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        skills: {
          id: 'skills',
          type: 'skill-input',
          value: [
            {
              skillId: 'skill-1',
              name: 'Market Research',
            },
            {
              skillId: 'skill-2',
              name: 'Market Research',
            },
          ] as any,
        },
        apiKey: {
          id: 'apiKey',
          type: 'text',
          value: 'secret-value',
        },
      },
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
})

describe('workflow import/export helpers', () => {
  it('exports a unified workflow file with one workflow entry and sanitized state', () => {
    const payload = createWorkflowExportFile({
      exportedFrom: 'workflowEditor',
      workflow: {
        name: '  Primary Workflow  ',
        description: '  Workflow used for trading  ',
        color: '  #3972F6  ',
        state: createWorkflowState(),
      },
    })

    expect(payload).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows'],
      skills: [],
      workflows: [
        {
          name: 'Primary Workflow',
          description: 'Workflow used for trading',
          color: '#3972F6',
          state: {
            blocks: {
              block_1: {
                subBlocks: {
                  apiKey: {
                    value: '',
                  },
                },
              },
            },
          },
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    })
  })

  it('exports workflow skills into the mixed unified format and resolves duplicate names', () => {
    const payload = createWorkflowExportFile({
      exportedFrom: 'workflowEditor',
      workflow: {
        name: 'Primary Workflow',
        description: 'Workflow used for trading',
        color: '#3972F6',
        state: createWorkflowStateWithSkills(),
      },
      skills: [
        {
          id: 'skill-1',
          name: '  Market Research  ',
          description: '  Research the market before execution.  ',
          content: 'Review catalysts and confirm direction.',
        },
        {
          id: 'skill-2',
          name: 'Market Research',
          description: 'Investigate the market before execution.',
          content: 'Follow the premarket checklist.',
        },
      ],
    })

    expect(payload.resourceTypes).toEqual(['workflows', 'skills'])
    expect(payload.skills).toEqual([
      {
        name: 'Market Research',
        description: 'Research the market before execution.',
        content: 'Review catalysts and confirm direction.',
      },
      {
        name: 'Market Research (imported) 1',
        description: 'Investigate the market before execution.',
        content: 'Follow the premarket checklist.',
      },
    ])
    expect(payload.workflows[0]?.state.blocks).toMatchObject({
      block_1: {
        subBlocks: {
          skills: {
            value: [
              {
                skillId: 'skill-1',
                name: 'Market Research',
              },
              {
                skillId: 'skill-2',
                name: 'Market Research (imported) 1',
              },
            ],
          },
        },
      },
    })
  })

  it('parses unified workflow import files and keeps the workflow payload', () => {
    const parsed = parseImportedWorkflowFile({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows', 'skills'],
      skills: [
        {
          name: 'Ignore me',
          description: 'Ignore this skill.',
          content: 'Use this skill only for tests.',
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
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.data).toMatchObject({
      name: 'Primary Workflow',
      description: 'Workflow used for trading',
      color: '#3972F6',
      skills: [
        {
          name: 'Ignore me',
          description: 'Ignore this skill.',
          content: 'Use this skill only for tests.',
        },
      ],
      state: {
        blocks: {
          block_1: {
            subBlocks: {
              apiKey: {
                value: 'secret-value',
              },
            },
          },
        },
      },
    })
  })

  it('parses legacy workflow import files when provided a fallback name', () => {
    const parsed = parseImportedWorkflowFile(
      {
        version: '1.0',
        exportedAt: '2026-04-08T15:30:00.000Z',
        state: createWorkflowState(),
      },
      {
        fallbackName: '  Legacy Workflow  ',
      }
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.data).toMatchObject({
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
    const parsed = parseImportedWorkflowFile({
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
    })

    expect(parsed.data).toBeNull()
    expect(parsed.errors[0]).toContain('Unsupported JSON format')
  })

  it('renames duplicate imported workflows with the imported marker', () => {
    expect(
      resolveImportedWorkflowName('Primary Workflow', [
        'Primary Workflow',
        'Primary Workflow (imported) 1',
      ])
    ).toBe('Primary Workflow (imported) 2')
  })

  it('keeps the imported marker only once when the incoming name already includes it', () => {
    expect(
      resolveImportedWorkflowName('Primary Workflow (imported)', [
        'Primary Workflow (imported)',
        'Primary Workflow (imported) 1',
      ])
    ).toBe('Primary Workflow (imported) 2')
  })
})
