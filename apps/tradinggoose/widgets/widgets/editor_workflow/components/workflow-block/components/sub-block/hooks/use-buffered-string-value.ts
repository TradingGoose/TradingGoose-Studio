import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'

interface UseBufferedStringValueOptions {
  externalValue: string | null | undefined
  onCommit: (value: string) => void
  delayMs?: number
  suspendExternalSync?: boolean
  commitOnUnmount?: boolean
}

export function useBufferedStringValue({
  externalValue,
  onCommit,
  delayMs = 120,
  suspendExternalSync = false,
  commitOnUnmount = true,
}: UseBufferedStringValueOptions) {
  const [value, setValue] = useState(() => externalValue ?? '')
  const valueRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (suspendExternalSync) {
      return
    }

    const nextValue = externalValue ?? ''
    if (nextValue !== valueRef.current) {
      setValue(nextValue)
    }
  }, [externalValue, suspendExternalSync])

  const cancelScheduledCommit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const applyNextValue = useCallback((nextValue: SetStateAction<string>) => {
    const resolvedValue =
      typeof nextValue === 'function'
        ? (nextValue as (current: string) => string)(valueRef.current)
        : nextValue

    valueRef.current = resolvedValue
    setValue(resolvedValue)
    return resolvedValue
  }, [])

  const setValueDebounced = useCallback(
    (nextValue: string) => {
      const resolvedValue = applyNextValue(nextValue)
      cancelScheduledCommit()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        onCommit(resolvedValue)
      }, delayMs)
    },
    [applyNextValue, cancelScheduledCommit, delayMs, onCommit]
  )

  const setValueLocal = useCallback(
    (nextValue: SetStateAction<string>) => {
      applyNextValue(nextValue)
    },
    [applyNextValue]
  )

  const commitNow = useCallback(
    (nextValue?: string) => {
      const resolvedValue = nextValue ?? valueRef.current
      cancelScheduledCommit()
      applyNextValue(resolvedValue)
      onCommit(resolvedValue)
    },
    [applyNextValue, cancelScheduledCommit, onCommit]
  )

  useEffect(() => {
    return () => {
      if (!timerRef.current) {
        return
      }

      clearTimeout(timerRef.current)
      timerRef.current = null

      if (commitOnUnmount) {
        onCommit(valueRef.current)
      }
    }
  }, [commitOnUnmount, onCommit])

  return {
    value,
    setValueLocal,
    setValueDebounced,
    commitNow,
    cancelScheduledCommit,
  }
}
