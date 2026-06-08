import { describe, expect, it } from 'vitest'
import {
  createCustomToolsExportFile,
  exportCustomToolsAsJson,
  parseImportedCustomToolsFile,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'

describe('custom tools import/export helpers', () => {
  it('exports a unified custom-tool file with dense resource arrays', () => {
    const payload = createCustomToolsExportFile({
      exportedFrom: 'customToolEditor',
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              description: 'Fetch top moving symbols.',
              parameters: {
                type: 'object',
                properties: {
                  session: {
                    type: 'string',
                  },
                },
                required: ['session'],
              },
            },
          },
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
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              description: 'Fetch top moving symbols.',
              parameters: {
                type: 'object',
                properties: {
                  session: {
                    type: 'string',
                  },
                },
                required: ['session'],
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

  it('serializes unified custom-tool export files as JSON', () => {
    const payload = exportCustomToolsAsJson({
      exportedFrom: 'customToolEditor',
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              description: 'Fetch top moving symbols.',
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
              name: 'fetchTopMovers',
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
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              description: 'Fetch top moving symbols.',
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

    expect(parsed.customTools).toEqual([
      {
        title: 'Fetch Top Movers',
        schema: {
          type: 'function',
          function: {
            name: 'fetchTopMovers',
            description: 'Fetch top moving symbols.',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
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
            schema: {
              type: 'function',
              function: {
                name: 'fetchTopMovers',
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
    ).toThrow()
  })

  it('renames imported titles when they collide with existing tools', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              name: 'myTool',
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
      usedFunctionNames: [],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]?.title).toBe('My Tool (imported) 1')
    expect(result.tools[0]?.schema.function.name).toBe('myTool')
  })

  it('renames imported function names when they collide with existing tools', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              name: 'myTool',
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
      usedFunctionNames: ['myTool'],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]?.title).toBe('My Tool')
    expect(result.tools[0]?.schema.function.name).toBe('myTool_imported_1')
  })

  it('renames colliding titles and function names within the imported batch', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              name: 'myTool',
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
              name: 'myTool',
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
      usedFunctionNames: [],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]?.title).toBe('My Tool')
    expect(result.tools[0]?.schema.function.name).toBe('myTool')
    expect(result.tools[1]?.title).toBe('My Tool (imported) 1')
    expect(result.tools[1]?.schema.function.name).toBe('myTool_imported_1')
  })

  it('renames both title and function name when a single imported tool collides on both', () => {
    const result = resolveImportedCustomTools({
      customTools: [
        {
          title: 'My Tool',
          schema: {
            type: 'function',
            function: {
              name: 'myTool',
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
      usedFunctionNames: ['myTool'],
    })

    expect(result.renamedCount).toBe(1)
    expect(result.tools[0]).toMatchObject({
      title: 'My Tool (imported) 1',
      schema: {
        function: {
          name: 'myTool_imported_1',
        },
      },
    })
  })
})
