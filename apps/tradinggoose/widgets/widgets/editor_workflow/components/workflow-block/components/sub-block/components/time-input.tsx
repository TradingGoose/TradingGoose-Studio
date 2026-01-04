'use client'

import * as React from 'react'
import { format, setHours, setMinutes, setSeconds } from 'date-fns'
import { SimpleTimePicker } from '@/components/ui/simple-time-picker'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface TimeInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: string | null
  className?: string
  disabled?: boolean
}

export function TimeInput({
  blockId,
  subBlockId,
  placeholder: _placeholder,
  isPreview = false,
  previewValue,
  className,
  disabled = false,
}: TimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const initialSkipRef = React.useRef(!value)

  React.useEffect(() => {
    initialSkipRef.current = !value
  }, [value])

  const parseTimeValue = React.useCallback((raw: string | null | undefined) => {
    const now = new Date()
    if (!raw) return now
    const [hours, minutes] = raw.split(':')
    const hour = Number.parseInt(hours, 10)
    const minute = Number.parseInt(minutes, 10)
    if (Number.isNaN(hour) || Number.isNaN(minute)) return now
    return setSeconds(setMinutes(setHours(now, hour), minute), 0)
  }, [])

  const dateValue = React.useMemo(() => parseTimeValue(value ?? undefined), [parseTimeValue, value])

  const handleChange = React.useCallback(
    (nextDate: Date) => {
      if (isPreview || disabled) return
      if (initialSkipRef.current) {
        initialSkipRef.current = false
        return
      }
      initialSkipRef.current = false
      setStoreValue(format(nextDate, 'HH:mm'))
    },
    [disabled, isPreview, setStoreValue]
  )

  return (
    <div className={className}>
      <SimpleTimePicker
        value={dateValue}
        onChange={handleChange}
        use12HourFormat
        timePicker={{ hour: true, minute: true, second: false }}
        disabled={isPreview || disabled}
      />
    </div>
  )
}
