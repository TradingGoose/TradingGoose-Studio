'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  className?: string
  isLoading?: boolean
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  className = 'max-w-md flex-1',
  isLoading = false,
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 text-muted-foreground' />
      <Input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className='h-9 w-full rounded-md border bg-background pr-9 pl-10 text-sm'
      />
      {isLoading ? (
        <div className='-translate-y-1/2 absolute top-1/2 right-3 z-10'>
          <div className='h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary' />
        </div>
      ) : (
        value &&
        !disabled && (
          <button
            onClick={() => onChange('')}
            className='-translate-y-1/2 absolute top-1/2 right-3 z-10 text-muted-foreground hover:text-foreground'
          >
            <X className='h-4 w-4' />
          </button>
        )
      )}
    </div>
  )
}
