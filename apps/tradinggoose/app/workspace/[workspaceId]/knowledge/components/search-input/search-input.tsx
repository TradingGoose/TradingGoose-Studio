'use client'

import { useId } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  clearLabel?: string
  disabled?: boolean
  className?: string
  busy?: boolean
  busyLabel?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  clearLabel,
  disabled = false,
  className = 'max-w-md flex-1',
  busy = false,
  busyLabel,
}: SearchInputProps) {
  const t = useTranslations('workspace.knowledge')
  const busyFeedbackId = useId()

  return (
    <div className={`relative ${className}`} aria-busy={busy || undefined}>
      <Search
        aria-hidden='true'
        className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 text-muted-foreground'
      />
      <Input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby={busy ? busyFeedbackId : undefined}
        disabled={disabled}
        className='h-9 w-full rounded-md border bg-background pr-4 pl-10 text-sm'
      />
      {busy ? (
        <div className='-translate-y-1/2 absolute top-1/2 right-3 z-10'>
          <div
            aria-hidden='true'
            className='h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary'
          />
        </div>
      ) : (
        value &&
        !disabled && (
          <button
            type='button'
            aria-label={clearLabel ?? t('clearSearch')}
            onClick={() => onChange('')}
            className='-translate-y-1/2 absolute top-1/2 right-3 z-10 text-muted-foreground hover:text-foreground'
          >
            <X className='h-4 w-4' />
          </button>
        )
      )}
      <span
        id={busyFeedbackId}
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='sr-only'
      >
        {busy ? busyLabel : null}
      </span>
    </div>
  )
}
