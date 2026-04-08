import { useRef } from 'react'

/**
 * Returns a ref that always holds the latest value.
 * Useful for accessing the current value inside callbacks/effects
 * without adding the value to dependency arrays.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
