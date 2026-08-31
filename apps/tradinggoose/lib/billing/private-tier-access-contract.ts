export const PRIVATE_TIER_ACCESS_ERROR_CODES = {
  unauthorized: 'unauthorized',
  rateLimited: 'rateLimited',
  unavailable: 'unavailable',
  required: 'required',
  invalid: 'invalid',
  loadFailed: 'loadFailed',
  validateFailed: 'validateFailed',
} as const

export type PrivateTierAccessErrorCode =
  (typeof PRIVATE_TIER_ACCESS_ERROR_CODES)[keyof typeof PRIVATE_TIER_ACCESS_ERROR_CODES]

export function isPrivateTierAccessErrorCode(value: unknown): value is PrivateTierAccessErrorCode {
  return Object.values<unknown>(PRIVATE_TIER_ACCESS_ERROR_CODES).includes(value)
}
