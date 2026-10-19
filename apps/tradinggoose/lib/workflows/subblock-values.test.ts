import { describe, expect, it } from 'vitest'
import {
  buildConfiguredSubBlockParams,
  resolveDisplayedSubBlockValue,
  resolveInitialSubBlockValue,
  stringifySubBlockValue,
} from './subblock-values'

describe('stringifySubBlockValue', () => {
  it.each([
    { value: ['NVDA', 'AAPL'], text: '["NVDA","AAPL"]' },
    { value: { symbol: 'NVDA' }, text: '{"symbol":"NVDA"}' },
    { value: 'NVDA', text: 'NVDA' },
    { value: 5, text: '5' },
    { value: false, text: 'false' },
    { value: null, text: '' },
    { value: undefined, text: '' },
  ])('formats $value for a text editor without losing structured values', ({ value, text }) => {
    expect(stringifySubBlockValue(value)).toBe(text)
  })
})

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

  it('does not initialize selectedTriggerId from configured values', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          id: 'selectedTriggerId',
          type: 'dropdown',
          value: () => 'github_webhook',
          defaultValue: 'github_webhook',
        },
        {}
      )
    ).toBe('')
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

describe('buildConfiguredSubBlockParams', () => {
  it('does not synthesize selectedTriggerId from configured subblock defaults', () => {
    expect(
      buildConfiguredSubBlockParams({
        subBlockConfigs: [
          {
            id: 'selectedTriggerId',
            type: 'dropdown',
            value: () => 'github_webhook',
          },
        ],
        subBlocks: {},
      })
    ).toEqual({})
  })
})
