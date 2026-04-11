import { describe, expect, it } from 'vitest'
import {
  createIndicatorsExportFile,
  exportIndicatorsAsJson,
  parseImportedIndicatorsFile,
  resolveImportedIndicatorName,
} from '@/lib/indicators/import-export'

describe('indicator import/export helpers', () => {
  it('exports a unified indicator file with dense resource arrays', () => {
    const payload = createIndicatorsExportFile({
      exportedFrom: 'indicatorEditor',
      indicators: [
        {
          name: 'RSI Export Example',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: {
            Length: {
              title: 'Length',
              type: 'int',
              defval: 14,
              minval: 1,
            },
          },
        },
      ],
    })

    expect(payload).toEqual({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'indicatorEditor',
      resourceTypes: ['indicators'],
      skills: [],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [
        {
          name: 'RSI Export Example',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: {
            Length: {
              title: 'Length',
              type: 'int',
              defval: 14,
              minval: 1,
            },
          },
        },
      ],
    })
  })

  it('serializes unified indicator export files as JSON', () => {
    const payload = exportIndicatorsAsJson({
      exportedFrom: 'indicatorEditor',
      indicators: [
        {
          name: 'RSI Export Example',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: undefined,
        },
      ],
    })

    expect(JSON.parse(payload)).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedFrom: 'indicatorEditor',
      resourceTypes: ['indicators'],
      skills: [],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [
        {
          name: 'RSI Export Example',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
        },
      ],
    })
  })

  it('parses mixed unified import files and returns the indicators section', () => {
    const parsed = parseImportedIndicatorsFile({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'indicatorEditor',
      resourceTypes: ['indicators', 'skills'],
      skills: [{ name: 'Ignore me' }],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [
        {
          name: '  RSI   Export Example  ',
          color: '  #3972F6  ',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: {},
        },
      ],
    })

    expect(parsed.indicators).toEqual([
      {
        name: 'RSI Export Example',
        color: '#3972F6',
        pineCode: "indicator('RSI Export Example')",
        inputMeta: {},
      },
    ])
  })

  it('rejects files that do not list indicators in resourceTypes', () => {
    expect(() =>
      parseImportedIndicatorsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'indicatorEditor',
        resourceTypes: ['skills'],
        indicators: [
          {
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      })
    ).toThrow()
  })

  it('rejects invalid fileType values', () => {
    expect(() =>
      parseImportedIndicatorsFile({
        version: '1',
        fileType: 'wrongFileType',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'indicatorEditor',
        resourceTypes: ['indicators'],
        indicators: [
          {
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      })
    ).toThrow()
  })

  it('rejects invalid version values', () => {
    expect(() =>
      parseImportedIndicatorsFile({
        version: '2',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'indicatorEditor',
        resourceTypes: ['indicators'],
        indicators: [
          {
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      })
    ).toThrow()
  })

  it('rejects import entries with extra keys', () => {
    expect(() =>
      parseImportedIndicatorsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-08T15:30:00.000Z',
        exportedFrom: 'indicatorEditor',
        resourceTypes: ['indicators'],
        indicators: [
          {
            id: 'indicator-1',
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      })
    ).toThrow()
  })

  it('renames duplicate imported indicators with the imported marker', () => {
    const resolvedName = resolveImportedIndicatorName('RSI Export Example', [
      'RSI Export Example',
      'RSI Export Example (imported) 1',
    ])

    expect(resolvedName).toBe('RSI Export Example (imported) 2')
  })
})
