'use client'

import * as React from 'react'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

interface DateTimeInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: string | Date | null
  disabled?: boolean
  className?: string
  config?: SubBlockConfig
}

const resolveDate = (raw: unknown): Date | undefined => {
  if (!raw) return undefined
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw
  if (typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      if (!Number.isNaN(numeric)) {
        const ms = trimmed.length <= 10 ? numeric * 1000 : numeric
        const date = new Date(ms)
        return Number.isNaN(date.getTime()) ? undefined : date
      }
    }
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

export function DateTimeInputField({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  className,
  config,
}: DateTimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)

  const rawValue = isPreview ? previewValue : storeValue
  const dateValue = React.useMemo(() => resolveDate(rawValue), [rawValue])

  return (
    <DateTimePicker
      value={dateValue}
      onChange={(nextDate) => {
        if (isPreview || disabled) return
        if (!nextDate) {
          setStoreValue('')
          return
        }
        setStoreValue(nextDate.toISOString())
      }}
      min={resolveDate(config?.minDate)}
      max={resolveDate(config?.maxDate)}
      timezone={config?.timezone}
      hideTime={config?.hideTime}
      use12HourFormat={config?.use12HourFormat}
      clearable={config?.clearable}
      timePicker={config?.timePicker}
      placeholder={config?.placeholder}
      disabled={isPreview || disabled}
      classNames={className ? { trigger: className } : undefined}
    />
  )
}
