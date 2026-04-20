'use client'

import { useEffect, useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { Badge, Button, Input } from '@/components/ui'

const MASKED_SECRET_VALUE = '************'

interface AdminInlineSecretFieldProps {
  id: string
  label: string
  description: string
  hasValue: boolean
  required?: boolean
  placeholder: string
  statusClassName?: string
  editStartValue?: string
  isSensitive?: boolean
  disabled?: boolean
  onSave: (value: string) => Promise<void> | void
  onClear?: () => Promise<void> | void
}

export function AdminInlineSecretField({
  id,
  label,
  description,
  hasValue,
  required = true,
  placeholder,
  statusClassName,
  editStartValue = '',
  isSensitive = true,
  disabled = false,
  onSave,
  onClear,
}: AdminInlineSecretFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingValue, setEditingValue] = useState(editStartValue)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setEditingValue(editStartValue)
    }
  }, [editStartValue, isEditing])

  const isBusy = disabled || isSubmitting
  const badgeLabel = hasValue ? 'Configured' : required ? 'Incomplete' : 'Optional'
  const badgeVariant = hasValue ? 'default' : required ? 'secondary' : 'outline'

  return (
    <div className='rounded-md border border-border/60 bg-muted/20 p-3'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0 space-y-1'>
          <div className='font-medium text-sm'>{label}</div>
          <div className='text-muted-foreground text-xs leading-relaxed'>{description}</div>
        </div>
        <Badge variant={badgeVariant} className={statusClassName}>
          {badgeLabel}
        </Badge>
      </div>

      {isEditing ? (
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 text-muted-foreground'
            disabled={isBusy || !editingValue.trim()}
            onClick={() => {
              void handleSave()
            }}
          >
            <Check className='h-4 w-4' />
            <span className='sr-only'>Save {label}</span>
          </Button>
          <div className='flex min-w-0 flex-1 items-center gap-2 rounded-md bg-background px-2 py-2'>
            <Input
              id={id}
              name={id}
              className='h-4 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
              type={isSensitive ? 'password' : 'text'}
              value={editingValue}
              placeholder={placeholder}
              onChange={(event) => setEditingValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSave()
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setIsEditing(false)
                }
              }}
              autoComplete={isSensitive ? 'new-password' : 'off'}
              data-1p-ignore={isSensitive ? 'true' : undefined}
              data-lpignore={isSensitive ? 'true' : undefined}
              data-bwignore={isSensitive ? 'true' : undefined}
              data-form-type={isSensitive ? 'other' : undefined}
            />
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 text-muted-foreground'
            disabled={isBusy}
            onClick={() => setIsEditing(false)}
          >
            <X className='h-4 w-4' />
            <span className='sr-only'>Cancel editing {label}</span>
          </Button>
        </div>
      ) : (
        <div className='flex items-center gap-2'>
          <div className='min-w-0 flex-1 rounded-md bg-background px-3 py-2'>
            <code className='block truncate font-mono text-xs'>
              {hasValue ? MASKED_SECRET_VALUE : 'Not set'}
            </code>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 text-muted-foreground'
            disabled={isBusy}
            onClick={() => setIsEditing(true)}
          >
            <Pencil className='h-4 w-4' />
            <span className='sr-only'>Edit {label}</span>
          </Button>
          {onClear ? (
            <Button
              type='button'
              variant='outline'
              size='icon'
              disabled={isBusy || !hasValue}
              onClick={() => {
                void handleClear()
              }}
            >
              <Trash2 className='h-4 w-4' />
              <span className='sr-only'>Clear {label}</span>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )

  async function handleSave() {
    const nextValue = editingValue.trim()
    if (!nextValue || isBusy) {
      return
    }

    setIsSubmitting(true)
    let didSucceed = false

    try {
      await onSave(editingValue)
      didSucceed = true
    } finally {
      setIsSubmitting(false)
      if (didSucceed) {
        setIsEditing(false)
      }
    }
  }

  async function handleClear() {
    if (!onClear || isBusy || !hasValue) {
      return
    }

    setIsSubmitting(true)
    let didSucceed = false

    try {
      await onClear()
      didSucceed = true
    } finally {
      setIsSubmitting(false)
      if (didSucceed) {
        setIsEditing(false)
      }
    }
  }
}
