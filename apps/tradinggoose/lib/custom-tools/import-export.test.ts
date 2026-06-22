import { describe, expect, it } from 'vitest'
import {
  createCustomToolsExportFile,
  exportCustomToolsAsJson,
  parseImportedCustomToolsFile,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'

const toolSchema = {
  type: 'function' as const,
  function: {
    description: 'Fetch top moving symbols.',
    parameters: {
      type: 'object' as const,
      properties: {
        session: {
          type: 'string',
        },
      },
      required: ['session'],
    },
  },
}

describe('custom tools import/export helpers', () => {
  it('exports a unified custom-tool file with title-only custom-tool identity', () => {
    const payload = createCustomToolsExportFile({
      exportedFrom: 'customToolEditor',
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: toolSchema,
          code: 'return { movers: [] }',
        },
      ],
    })

    expect(payload).toEqual({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools'],
      skills: [],
      workflows: [],
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: toolSchema,
          code: 'return { movers: [] }',
        },
      ],
      watchlists: [],
      indicators: [],
    })
  })

  it('rejects blank custom-tool titles in transfer files', () => {
    expect(() =>
      createCustomToolsExportFile({
        exportedFrom: 'customToolEditor',
        customTools: [
          {
            title: '   ',
            schema: toolSchema,
            code: '',
          },
        ],
      })
    ).toThrow('Tool title is required')
  })

  it('rejects function names because custom-tool title is canonical', () => {
    expect(() =>
      parseCustomToolSchemaText(
        JSON.stringify({
          type: 'function',
          function: {
            name: 'fetchTopMovers',
            parameters: { type: 'object', properties: {} },
          },
        })
      )
    ).toThrow(/Unrecognized key.*name/)
  })

  it('serializes unified custom-tool export files as JSON', () => {
    const payload = exportCustomToolsAsJson({
      exportedFrom: 'customToolEditor',
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: 'return { movers: [] }',
        },
      ],
    })

    expect(JSON.parse(payload)).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools'],
      skills: [],
      workflows: [],
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: 'return { movers: [] }',
        },
      ],
      watchlists: [],
      indicators: [],
    })
  })

  it('parses mixed unified import files and returns the custom tools section', () => {
    const parsed = parseImportedCustomToolsFile({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools', 'skills'],
      skills: [
        {
          name: 'Ignore me',
        },
      ],
      workflows: [],
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: toolSchema,
          code: 'return { movers: [] }',
        },
      ],
      watchlists: [],
      indicators: [],
    })

    expect(parsed.customTools).toEqual([
      {
        title: 'Fetch Top Movers',
        schema: toolSchema,
        code: 'return { movers: [] }',
      },
    ])
  })

  it('rejects files that do not list customTools in resourceTypes', () => {
    expect(() =>
      parseImportedCustomToolsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'customToolEditor',
        resourceTypes: ['skills'],
        customTools: [
          {
            title: 'Fetch Top Movers',
            schema: toolSchema,
            code: 'return { movers: [] }',
          },
        ],
      })
    ).toThrow()
  })

  it('rejects import files with blank custom-tool titles', () => {
    expect(() =>
      parseImportedCustomToolsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'customToolEditor',
        resourceTypes: ['customTools'],
        customTools: [
          {
            title: '  ',
            schema: toolSchema,
            code: '',
          },
        ],
      })
    ).toThrow('Tool title is required')
  })

  it('renames imported titles when they collide with existing tools', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: '',
        },
      ],
      usedTitles: ['My Tool'],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]?.title).toBe('My Tool (imported) 1')
  })

  it('renames colliding titles within the imported batch', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: '',
        },
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: '',
        },
      ],
      usedTitles: [],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]?.title).toBe('My Tool')
    expect(result.tools[1]?.title).toBe('My Tool (imported) 1')
  })
})
