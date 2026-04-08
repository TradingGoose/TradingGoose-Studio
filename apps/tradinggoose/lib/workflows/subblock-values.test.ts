import { describe, expect, it } from 'vitest'
import { resolveDisplayedSubBlockValue, resolveInitialSubBlockValue } from './subblock-values'

describe('resolveInitialSubBlockValue', () => {
  it('uses defaultValue when no explicit or configured value exists', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'code',
          value: undefined,
          defaultValue: '{\n  "example": true\n}',
        },
        {}
      )
    ).toBe('{\n  "example": true\n}')
  })

  it('prefers a configured value over defaultValue', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'dropdown',
          value: () => 'gmail_poller',
          defaultValue: 'manual',
        },
        {}
      )
    ).toBe('gmail_poller')
  })

  it('prefers an explicit override over configured and default values', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'code',
          value: () => 'configured',
          defaultValue: 'default',
        },
        {},
        'override'
      )
    ).toBe('override')
  })
})

describe('resolveDisplayedSubBlockValue', () => {
  it('uses the default value for read-only fields when the stored value is blank', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: true,
          defaultValue: '{\n  "example": true\n}',
        },
        ''
      )
    ).toBe('{\n  "example": true\n}')
  })

  it('preserves a blank stored value for writable fields', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: false,
          defaultValue: '{\n  "example": true\n}',
        },
        ''
      )
    ).toBe('')
  })

  it('returns non-string defaults as cloned values for display', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: true,
          defaultValue: { example: true },
        },
        null
      )
    ).toEqual({ example: true })
  })
})
