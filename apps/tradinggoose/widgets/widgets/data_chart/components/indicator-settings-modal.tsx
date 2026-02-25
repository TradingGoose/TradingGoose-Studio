'use client'

import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { InputMetaMap } from '@/lib/indicators/types'

type IndicatorSettingsMeta = {
  name: string
  inputMeta?: InputMetaMap | null
}

type IndicatorSettingsModalProps = {
  indicatorId: string | null
  meta: IndicatorSettingsMeta | null
  draft: Record<string, unknown>
  onDraftChange: (title: string, value: unknown) => void
  onClose: () => void
  onSave: () => void
}

const resolveDraftValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

export const IndicatorSettingsModal = ({
  indicatorId,
  meta,
  draft,
  onDraftChange,
  onClose,
  onSave,
}: IndicatorSettingsModalProps) => {
  if (!meta) return null

  const inputEntries = meta.inputMeta
    ? Object.entries(meta.inputMeta).map(([title, inputMeta]) => ({ title, meta: inputMeta }))
    : []

  return (
    <div
      className='absolute inset-0 z-40 flex items-center justify-center bg-secondary/40 p-4 backdrop-blur-sm'
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className='w-full max-w-md rounded-md border border-border bg-background p-4 shadow-lg'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <p className='font-semibold text-base text-foreground'>{meta.name}</p>
            <p className='text-muted-foreground text-xs'>Indicator settings</p>
          </div>
          <button
            type='button'
            className='inline-flex h-8 w-8 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-muted/40 p-0 font-medium text-sm ring-offset-background transition-colors hover:bg-muted hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0'
            onClick={onClose}
          >
            <X aria-hidden='true' />
            <span className='sr-only'>Close</span>
          </button>
        </div>
        <div className='mt-4 space-y-3'>
          {inputEntries.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No configurable inputs.</p>
          ) : (
            inputEntries.map(({ title, meta: inputMeta }) => {
              const draftValue = draft[title]
              const resolvedValue =
                typeof draftValue !== 'undefined' ? draftValue : (inputMeta.defval ?? '')
              if (inputMeta.type === 'bool') {
                return (
                  <label
                    key={`${indicatorId ?? 'indicator'}-${title}`}
                    className='flex items-center justify-between gap-3 text-sm'
                  >
                    <span className='font-medium text-foreground'>{title}</span>
                    <input
                      type='checkbox'
                      className='h-4 w-4 accent-primary'
                      checked={Boolean(resolvedValue)}
                      onChange={(event) => onDraftChange(title, event.target.checked)}
                    />
                  </label>
                )
              }

              if (Array.isArray(inputMeta.options) && inputMeta.options.length > 0) {
                return (
                  <label
                    key={`${indicatorId ?? 'indicator'}-${title}`}
                    className='flex flex-col gap-1 text-sm'
                  >
                    <span className='font-medium text-foreground'>{title}</span>
                    <select
                      className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                      value={resolveDraftValue(resolvedValue)}
                      onChange={(event) => onDraftChange(title, event.target.value)}
                    >
                      {inputMeta.options.map((option) => (
                        <option
                          key={`${indicatorId ?? 'indicator'}-${title}-${String(option)}`}
                          value={String(option)}
                        >
                          {String(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              }

              const isNumber = inputMeta.type === 'int' || inputMeta.type === 'float'
              const inputId = `${indicatorId ?? 'indicator'}-${title}-input`
              return (
                <label
                  key={`${indicatorId ?? 'indicator'}-${title}`}
                  className='flex flex-col gap-1 text-sm'
                  htmlFor={inputId}
                >
                  <span className='font-medium text-foreground'>{title}</span>
                  <Input
                    id={inputId}
                    type={isNumber ? 'number' : 'text'}
                    value={resolveDraftValue(resolvedValue)}
                    onChange={(event) => onDraftChange(title, event.target.value)}
                    min={typeof inputMeta.minval === 'number' ? inputMeta.minval : undefined}
                    max={typeof inputMeta.maxval === 'number' ? inputMeta.maxval : undefined}
                    step={typeof inputMeta.step === 'number' ? inputMeta.step : undefined}
                  />
                </label>
              )
            })
          )}
        </div>
        <div className='mt-4 flex items-center justify-end gap-2'>
          <button
            type='button'
            className='inline-flex h-9 items-center justify-center rounded-sm border border-input px-3 text-foreground text-sm hover:bg-muted'
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type='button'
            className='inline-flex h-9 items-center justify-center rounded-sm bg-primary px-3 text-primary-foreground text-sm hover:bg-primary-hover'
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
