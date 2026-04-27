import { describe, expect, it } from 'vitest'
import { normalizeIndicatorInputOverrides } from '@/lib/indicators/monitor-config'
import type { InputMetaMap } from '@/lib/indicators/types'

const inputMeta: InputMetaMap = {
  Length: {
    title: 'Length',
    type: 'int',
    defval: 14,
  },
  Threshold: {
    title: 'Threshold',
    type: 'float',
    defval: 1.5,
  },
  Enabled: {
    title: 'Enabled',
    type: 'bool',
    defval: true,
  },
  Label: {
    title: 'Label',
    type: 'string',
    defval: 'default',
  },
}

describe('normalizeIndicatorInputOverrides', () => {
  it('persists only sparse non-default indicator input overrides', () => {
    expect(
      normalizeIndicatorInputOverrides(inputMeta, {
        Length: '20.9',
        Threshold: '2.75',
        Enabled: 'false',
        Label: 'custom',
        Missing: 'ignored',
      })
    ).toEqual({
      Length: 20,
      Threshold: 2.75,
      Enabled: false,
      Label: 'custom',
    })
  })

  it('drops default-expanded values and invalid overrides', () => {
    expect(
      normalizeIndicatorInputOverrides(inputMeta, {
        Length: '14',
        Threshold: 'bad-number',
        Enabled: 'maybe',
        Label: 'default',
      })
    ).toBeUndefined()
  })

  it('clears overrides when metadata or raw inputs are empty', () => {
    expect(normalizeIndicatorInputOverrides(undefined, { Length: 20 })).toBeUndefined()
    expect(normalizeIndicatorInputOverrides(inputMeta, {})).toBeUndefined()
  })
})
