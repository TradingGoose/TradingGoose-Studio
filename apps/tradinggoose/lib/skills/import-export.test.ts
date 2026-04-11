import { describe, expect, it } from 'vitest'
import {
  createSkillsExportFile,
  exportSkillsAsJson,
  parseImportedSkillsFile,
  resolveImportedSkillName,
} from '@/lib/skills/import-export'

describe('skills import/export helpers', () => {
  it('exports a single-skill unified TradingGoose file', () => {
    const payload = createSkillsExportFile({
      exportedFrom: 'skillEditor',
      skills: [
        {
          name: 'Market Research',
          description: 'Research the market before execution.',
          content: 'Review catalysts and confirm direction.',
        },
      ],
    })

    expect(payload.version).toBe('1')
    expect(payload.fileType).toBe('tradingGooseExport')
    expect(payload.exportedFrom).toBe('skillEditor')
    expect(payload.resourceTypes).toEqual(['skills'])
    expect(payload.skills).toEqual([
      {
        name: 'Market Research',
        description: 'Research the market before execution.',
        content: 'Review catalysts and confirm direction.',
      },
    ])
    expect(payload.workflows).toEqual([])
    expect(payload.customTools).toEqual([])
    expect(payload.watchlists).toEqual([])
    expect(payload.indicators).toEqual([])
  })

  it('serializes unified skill export files as JSON', () => {
    const payload = exportSkillsAsJson({
      exportedFrom: 'skillEditor',
      skills: [
        {
          name: 'Market Research',
          description: 'Research the market before execution.',
          content: 'Review catalysts and confirm direction.',
        },
      ],
    })

    expect(JSON.parse(payload)).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedFrom: 'skillEditor',
      resourceTypes: ['skills'],
      skills: [
        {
          name: 'Market Research',
          description: 'Research the market before execution.',
          content: 'Review catalysts and confirm direction.',
        },
      ],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [],
    })
  })

  it('parses mixed unified import files and trims skill fields', () => {
    const parsed = parseImportedSkillsFile({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-06T12:00:00.000Z',
      exportedFrom: 'skillList',
      resourceTypes: ['skills', 'workflows'],
      skills: [
        {
          name: '  Market   Research  ',
          description: '  Investigate the market.  ',
          content: 'Keep the original content formatting.',
        },
      ],
      workflows: [
        {
          name: 'Workflow copy',
        },
      ],
    })

    expect(parsed).toEqual([
      {
        name: 'Market Research',
        description: 'Investigate the market.',
        content: 'Keep the original content formatting.',
      },
    ])
  })

  it('rejects invalid fileType values', () => {
    expect(() =>
      parseImportedSkillsFile({
        version: '1',
        fileType: 'wrongFileType',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['skills'],
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Keep the original content formatting.',
          },
        ],
      })
    ).toThrow()
  })

  it('rejects invalid version values', () => {
    expect(() =>
      parseImportedSkillsFile({
        version: '2',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['skills'],
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Keep the original content formatting.',
          },
        ],
      })
    ).toThrow()
  })

  it('rejects files that do not list skills in resourceTypes', () => {
    expect(() =>
      parseImportedSkillsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['workflows'],
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Keep the original content formatting.',
          },
        ],
      })
    ).toThrow()
  })

  it('rejects files missing the skills section', () => {
    expect(() =>
      parseImportedSkillsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['skills'],
      })
    ).toThrow()
  })

  it('rejects import entries with extra keys', () => {
    expect(() =>
      parseImportedSkillsFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['skills'],
        skills: [
          {
            id: 'skill-1',
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Keep the original content formatting.',
          },
        ],
      })
    ).toThrow()
  })

  it('renames duplicate imported skills with the imported marker', () => {
    const resolvedName = resolveImportedSkillName('Market Research', [
      'Market Research',
      'Market Research (imported) 1',
      'Market Research (imported) 2',
    ])

    expect(resolvedName).toBe('Market Research (imported) 3')
  })

  it('increments names that already include the imported marker', () => {
    const resolvedName = resolveImportedSkillName('Market Research (imported)', [
      'Market Research (imported)',
      'Market Research (imported) 1',
    ])

    expect(resolvedName).toBe('Market Research (imported) 2')
  })
})
