import { expect, it } from 'vitest'
import { resolveComboBoxDisplayValue } from './combobox'

it.each([
  ['xhigh', false, false, true, ''],
  ['xhigh', true, false, true, 'xhigh'],
  ['xhigh', false, true, true, 'xhigh'],
  ['xhigh', false, false, false, 'xhigh'],
  ['<variable.effort>', false, false, true, '<variable.effort>'],
  ['{{REASONING_EFFORT}}', false, false, true, '{{REASONING_EFFORT}}'],
] as const)(
  'resolves model-control display value %#',
  (value, selected, typed, capability, expected) => {
    expect(resolveComboBoxDisplayValue(value, selected, typed, capability)).toBe(expected)
  }
)
