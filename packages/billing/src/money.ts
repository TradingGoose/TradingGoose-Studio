import BigNumber from 'bignumber.js'

/** Canonical nonnegative finite decimal text. Money never crosses a binary64 boundary. */
export type DecimalAmount = string
const Decimal = BigNumber.clone({ RANGE: 1_000_000_000 })
const DisplayDecimal = Decimal.clone({ DECIMAL_PLACES: 4, ROUNDING_MODE: Decimal.ROUND_HALF_UP })
const grammar = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function checked(value: BigNumber): DecimalAmount {
  if (
    !value.isFinite() ||
    value.isNegative() ||
    (value.e !== null && value.e > 131_071) ||
    (value.decimalPlaces() ?? 0) > 16_383
  )
    throw new RangeError('Financial decimal is outside the finite PostgreSQL NUMERIC range')
  return value.isZero() ? '0' : value.toFixed()
}

export function monetary(value: unknown): DecimalAmount {
  if (typeof value !== 'string' || !grammar.test(value))
    throw new RangeError('Financial amounts require nonnegative decimal strings')
  const decimal = new Decimal(value)
  if (decimal.isZero() && /[1-9]/.test(value.split(/[eE]/)[0]))
    throw new RangeError('Nonzero financial decimal cannot underflow to zero')
  return checked(decimal)
}
const decimal = (value: DecimalAmount) => new Decimal(monetary(value))
export function compareMoney(a: DecimalAmount, b: DecimalAmount): -1 | 0 | 1 {
  return decimal(a).comparedTo(decimal(b)) as -1 | 0 | 1
}
export function addMoney(...values: DecimalAmount[]): DecimalAmount {
  return checked(values.reduce((sum, value) => sum.plus(decimal(value)), new Decimal('0')))
}
export function subtractMoney(a: DecimalAmount, b: DecimalAmount): DecimalAmount {
  return checked(decimal(a).minus(decimal(b)))
}
export function subtractMoneyClamped(a: DecimalAmount, b: DecimalAmount): DecimalAmount {
  return compareMoney(a, b) < 0 ? '0' : subtractMoney(a, b)
}
export function multiplyMoney(a: DecimalAmount, b: DecimalAmount): DecimalAmount {
  return checked(decimal(a).multipliedBy(decimal(b)))
}
export function minMoney(...values: DecimalAmount[]): DecimalAmount {
  if (!values.length) throw new RangeError('A decimal minimum requires an amount')
  return values.map(monetary).reduce((a, b) => (compareMoney(a, b) <= 0 ? a : b))
}
export function maxMoney(...values: DecimalAmount[]): DecimalAmount {
  return values.map(monetary).reduce((a, b) => (compareMoney(a, b) >= 0 ? a : b), '0')
}
export function shiftMoney(value: DecimalAmount, places: number): DecimalAmount {
  if (!Number.isSafeInteger(places)) throw new RangeError('Decimal shift must be a safe integer')
  const original = decimal(value)
  const shifted = original.shiftedBy(places)
  if (!original.isZero() && shifted.isZero())
    throw new RangeError('Nonzero financial decimal cannot underflow during a shift')
  return checked(shifted)
}
/** Quantities and provider integer cents only; this is never a monetary-number ingress. */
export function decimalFromSafeInteger(value: number): DecimalAmount {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Financial quantity must be a nonnegative safe integer')
  return String(value)
}
function integer(value: DecimalAmount): BigNumber {
  const amount = decimal(value)
  if (!amount.isInteger()) throw new RangeError('Financial cents must be an integer string')
  return amount
}
/** Existing nonnegative invoice boundary: round USD to cents, half up. */
export function usdToCents(value: DecimalAmount): DecimalAmount {
  return checked(decimal(value).shiftedBy(2).integerValue(Decimal.ROUND_HALF_UP))
}
export function centsToUsd(value: DecimalAmount): DecimalAmount {
  return checked(integer(value).shiftedBy(-2))
}
/** The only provider monetary-number boundary, after proof of exact integer representation. */
export function centsToProviderNumber(value: DecimalAmount): number {
  const amount = integer(value)
  if (amount.isGreaterThan(String(Number.MAX_SAFE_INTEGER)))
    throw new RangeError('Financial cents exceed the provider safe-integer boundary')
  return amount.toNumber()
}

/** Rounded, bounded presentation ratio only. Financial decisions use compareMoney/products. */
export function displayPercentage(part: DecimalAmount, total: DecimalAmount): number {
  const numerator = decimal(part)
  const denominator = decimal(total)
  if (numerator.isZero()) return 0
  if (denominator.isZero() || numerator.isGreaterThanOrEqualTo(denominator)) return 100
  return new DisplayDecimal(numerator)
    .multipliedBy('100')
    .dividedBy(new DisplayDecimal(denominator))
    .toNumber()
}
