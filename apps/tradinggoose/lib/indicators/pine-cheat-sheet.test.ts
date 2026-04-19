import { describe, expect, it } from 'vitest'
import {
  CHEAT_SHEET_MEMBERS,
  PINE_CHEAT_SHEET_EXTRA_LIBS,
  PINE_CHEAT_SHEET_TYPE_DEFS,
} from '@/lib/indicators/pine-cheat-sheet'

describe('pine cheat sheet', () => {
  it('derives cheat sheet members from the generated Pinets surface', () => {
    expect(CHEAT_SHEET_MEMBERS.input).toContain('int')
    expect(CHEAT_SHEET_MEMBERS.ta).toContain('rsi')
    expect(CHEAT_SHEET_MEMBERS.indicator).toContain('overlay')
    expect(CHEAT_SHEET_MEMBERS.trigger).toEqual(['trigger'])
  })

  it('builds the Monaco extra lib bundle from the derived type definitions', () => {
    expect(PINE_CHEAT_SHEET_TYPE_DEFS).toContain('declare const input: InputNamespace')
    expect(PINE_CHEAT_SHEET_TYPE_DEFS).toContain('declare const indicator: (')
    expect(PINE_CHEAT_SHEET_EXTRA_LIBS).toEqual([
      {
        filePath: 'inmemory://model/pine-globals.d.ts',
        content: PINE_CHEAT_SHEET_TYPE_DEFS,
      },
    ])
  })
})
