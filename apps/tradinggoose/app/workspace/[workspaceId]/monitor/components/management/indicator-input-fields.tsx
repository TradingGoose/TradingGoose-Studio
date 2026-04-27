'use client'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import type { InputMeta, InputMetaMap } from '@/lib/indicators/types'

type IndicatorInputFieldsProps = {
  inputMeta: InputMetaMap | undefined
  sparseInputs: Record<string, unknown>
  onChange: (nextSparseInputs: Record<string, unknown>) => void
  disabled?: boolean
}

type IndicatorInputSummaryProps = {
  inputMeta: InputMetaMap | undefined
  sparseInputs: Record<string, unknown>
}

const formatInputValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (value == null) return '--'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const toFieldValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  return ''
}

const coerceDraftValue = (meta: InputMeta, value: unknown) => {
  if (meta.type === 'int' || meta.type === 'float') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return meta.type === 'int' ? Math.trunc(value) : value
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return meta.type === 'int' ? Math.trunc(parsed) : parsed
    }
    return undefined
  }

  if (meta.type === 'bool') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value === 'true') return true
      if (value === 'false') return false
    }
    return undefined
  }

  return value ?? undefined
}

const valuesEqual = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

const patchSparseInput = (
  inputMeta: InputMetaMap,
  sparseInputs: Record<string, unknown>,
  title: string,
  rawValue: unknown
) => {
  const meta = inputMeta[title]
  if (!meta) return sparseInputs

  const next = { ...sparseInputs }
  const coerced = coerceDraftValue(meta, rawValue)
  const defaultValue = coerceDraftValue(meta, meta.value ?? meta.defval)

  if (typeof coerced === 'undefined' || valuesEqual(coerced, defaultValue)) {
    delete next[title]
  } else {
    next[title] = coerced
  }

  return next
}

export function IndicatorInputFields({
  inputMeta,
  sparseInputs,
  onChange,
  disabled = false,
}: IndicatorInputFieldsProps) {
  if (!inputMeta) return null

  const entries = Object.entries(inputMeta)
  if (entries.length === 0) return null

  const resolvedInputs = buildInputsMapFromMeta(inputMeta, sparseInputs)

  return (
    <div className='space-y-2'>
      <Label className='text-muted-foreground text-xs'>Indicator Inputs</Label>
      <div className='grid gap-3 sm:grid-cols-2'>
        {entries.map(([title, meta]) => {
          const resolvedValue = resolvedInputs[title]
          const inputId = `monitor-indicator-input-${title}`

          if (meta.type === 'bool') {
            return (
              <Label
                key={title}
                className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'
              >
                <span className='min-w-0 truncate font-medium'>{title}</span>
                <Checkbox
                  checked={Boolean(resolvedValue)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(patchSparseInput(inputMeta, sparseInputs, title, checked === true))
                  }
                />
              </Label>
            )
          }

          if (Array.isArray(meta.options) && meta.options.length > 0) {
            return (
              <div key={title} className='space-y-1 text-sm'>
                <span className='font-medium'>{title}</span>
                <Select
                  value={toFieldValue(resolvedValue)}
                  disabled={disabled}
                  onValueChange={(value) =>
                    onChange(patchSparseInput(inputMeta, sparseInputs, title, value))
                  }
                >
                  <SelectTrigger id={inputId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {meta.options.map((option) => (
                      <SelectItem key={`${title}-${String(option)}`} value={String(option)}>
                        {String(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          }

          const isNumber = meta.type === 'int' || meta.type === 'float'
          return (
            <label key={title} className='space-y-1 text-sm' htmlFor={inputId}>
              <span className='font-medium'>{title}</span>
              <Input
                id={inputId}
                type={isNumber ? 'number' : 'text'}
                value={toFieldValue(resolvedValue)}
                disabled={disabled}
                min={typeof meta.minval === 'number' ? meta.minval : undefined}
                max={typeof meta.maxval === 'number' ? meta.maxval : undefined}
                step={typeof meta.step === 'number' ? meta.step : undefined}
                onChange={(event) =>
                  onChange(patchSparseInput(inputMeta, sparseInputs, title, event.target.value))
                }
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}

export function IndicatorInputSummary({ inputMeta, sparseInputs }: IndicatorInputSummaryProps) {
  if (!inputMeta) return null

  const resolvedInputs = buildInputsMapFromMeta(inputMeta, sparseInputs)
  const entries = Object.entries(resolvedInputs)
  if (entries.length === 0) return null

  return (
    <div className='flex flex-wrap gap-1.5'>
      {entries.map(([title, value]) => (
        <Badge key={title} variant='secondary' className='font-normal text-muted-foreground'>
          {title}: {formatInputValue(value)}
        </Badge>
      ))}
    </div>
  )
}
