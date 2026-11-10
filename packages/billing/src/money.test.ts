import { describe, expect, it } from 'bun:test'
import {
  addMoney,
  centsToProviderNumber,
  centsToUsd,
  compareMoney,
  decimalFromSafeInteger,
  displayPercentage,
  maxMoney,
  minMoney,
  monetary,
  multiplyMoney,
  shiftMoney,
  subtractMoney,
  subtractMoneyClamped,
  usdToCents,
} from './money'

describe('lossless canonical decimal ABI', () => {
  it('preserves the exact witnesses and normalizes only insignificant representation', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3')
    expect(compareMoney(addMoney('0.30000000000000001', '0.7'), '1')).toBe(1)
    expect(compareMoney('0.30000000000000001', '0.3')).toBe(1)
    expect(monetary('+000.3000000000000000100')).toBe('0.30000000000000001')
    expect(monetary('3.0000000000000001e-1')).toBe('0.30000000000000001')
    expect(JSON.stringify({ amount: monetary('3e-17') })).toBe('{"amount":"0.00000000000000003"}')
  })
  it('rejects every monetary-number input and malformed or underflowed value', () => {
    for (const value of [
      0,
      0.1,
      1,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
      '',
      ' ',
      ' 1',
      '1 ',
      '0xff',
      'NaN',
      'Infinity',
      '-0',
      '-1',
      '-1e-999',
      '1e-1000000001',
    ])
      expect(() => monetary(value)).toThrow(RangeError)
  })
  it('preserves the entire supported PostgreSQL numeric range without quantization', () => {
    expect(monetary('1e131071')).toHaveLength(131072)
    expect(monetary('1e-16383')).toHaveLength(16385)
    for (const value of ['1e131072', '1e-16384']) expect(() => monetary(value)).toThrow(RangeError)
    expect(() => multiplyMoney('1e131071', '10')).toThrow(RangeError)
    expect(() => multiplyMoney('1e-16383', '0.1')).toThrow(RangeError)
    expect(() => shiftMoney('1', -9007199254740991)).toThrow(RangeError)
    expect(shiftMoney('0', -9007199254740991)).toBe('0')
  })
  it('uses exact operations for grants, floors, multipliers and retained sub-cent values', () => {
    expect(subtractMoney('0.3', '0.1')).toBe('0.2')
    expect(subtractMoneyClamped('0.1', '0.30000000000000001')).toBe('0')
    expect(() => subtractMoney('0.1', '0.2')).toThrow(RangeError)
    expect(minMoney('0.30000000000000001', '0.3')).toBe('0.3')
    expect(maxMoney('0.30000000000000001', '0.3')).toBe('0.30000000000000001')
    expect(multiplyMoney('0.10000000000000001', decimalFromSafeInteger(3))).toBe(
      '0.30000000000000003'
    )
    expect(shiftMoney(multiplyMoney('0.00000000000000001', decimalFromSafeInteger(1234)), -3)).toBe(
      '0.00000000000000001234'
    )
    expect(() => decimalFromSafeInteger(1.5)).toThrow(RangeError)
    expect(() => decimalFromSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })
  it('rounds only at the explicit nonnegative half-up invoice boundary', () => {
    for (const [usd, cents] of [
      ['0.004999999999999999', '0'],
      ['0.005', '1'],
      ['0.014999999999999999', '1'],
      ['0.015', '2'],
      ['0.30000000000000001', '30'],
    ])
      expect(usdToCents(usd)).toBe(cents)
    expect(centsToUsd('30')).toBe('0.3')
    expect(centsToProviderNumber('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => centsToProviderNumber('9007199254740992')).toThrow(RangeError)
    expect(() => centsToProviderNumber('1.1')).toThrow(RangeError)
    expect(() => centsToUsd('0.5')).toThrow(RangeError)
  })
  it('bounds display-only percentages even for tiny and huge valid money', () => {
    expect(displayPercentage('0', '0')).toBe(0)
    expect(displayPercentage('1', '0')).toBe(100)
    expect(displayPercentage('1e-16383', '3e-16383')).toBe(33.3333)
    expect(displayPercentage('1e131071', '3e131071')).toBe(33.3333)
    expect(displayPercentage('4', '3')).toBe(100)
    expect(() => displayPercentage('unknown', '1')).toThrow(RangeError)
  })
})
