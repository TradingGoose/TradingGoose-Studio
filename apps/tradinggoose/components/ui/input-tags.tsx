'use client'

import { forwardRef, useState } from 'react'

import { XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, type InputProps } from '@/components/ui/input'

type InputTagsProps = Omit<InputProps, 'onChange' | 'value'> & {
  value: string[]
  onChange: (value: string[]) => void
  emptyMessage?: string
}

export const InputTags = forwardRef<HTMLInputElement, InputTagsProps>(
  ({ value, onChange, emptyMessage = 'No tags.', ...props }, ref) => {
    const [pendingTag, setPendingTag] = useState('')

    const addPendingTag = () => {
      const trimmed = pendingTag.trim()
      if (!trimmed) return
      const next = new Set(value)
      next.add(trimmed)
      onChange(Array.from(next))
      setPendingTag('')
    }

    return (
      <>
        <div className='flex'>
          <Input
            value={pendingTag}
            onChange={(event) => setPendingTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
                event.preventDefault()
                addPendingTag()
              }
            }}
            className='mr-2'
            {...props}
            ref={ref}
          />
          <Button
            type='button'
            variant='secondary'
            className='border border-l-0'
            onClick={addPendingTag}
          >
            Add
          </Button>
        </div>
        <div className='min-h-[2.5rem] flex flex-wrap items-center gap-2 overflow-y-auto p-2'>
          {value.map((item) => (
            <Badge key={item} variant='secondary'>
              {item}
              <button
                type='button'
                className='ml-2'
                onClick={() => {
                  onChange(value.filter((tag) => tag !== item))
                }}
              >
                <XIcon className='w-3' />
              </button>
            </Badge>
          ))}
          {!value.length && (
            <span className='text-xs text-muted-foreground'>{emptyMessage}</span>
          )}
        </div>
      </>
    )
  }
)

InputTags.displayName = 'InputTags'
