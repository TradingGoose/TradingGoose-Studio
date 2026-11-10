'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { compareMoney, monetary } from '@tradinggoose/billing/money'
import { Check, LoaderCircle, Pencil, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { organizationMutationOptions } from '@/hooks/queries/organization'
import { subscriptionMutationOptions } from '@/hooks/queries/subscription'
import { formatUsd } from '@/i18n/formatters'

const logger = createLogger('UsageLimit')

interface UsageLimitProps {
  currentLimit: string | null | undefined
  currentUsage: string | null | undefined
  canEdit: boolean
  minimumLimit: string | null | undefined
  context?: 'user' | 'organization'
  organizationId?: string
}

export interface UsageLimitRef {
  startEdit: () => void
}

export const UsageLimit = forwardRef<UsageLimitRef, UsageLimitProps>(
  (
    { currentLimit, currentUsage, canEdit, minimumLimit, context = 'user', organizationId },
    ref
  ) => {
    const locale = useLocale()
    const editable =
      canEdit &&
      typeof currentLimit === 'string' &&
      typeof currentUsage === 'string' &&
      typeof minimumLimit === 'string'
    const t = useTranslations('workspace.settingsModal.subscription.limit')
    const [inputValue, setInputValue] = useState(currentLimit ?? '')
    const [errorType, setErrorType] = useState<'general' | 'belowUsage' | null>(null)
    const hasError = errorType !== null
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const submitLockRef = useRef(false)
    const queryClient = useQueryClient()

    const updateUserLimitMutation = useMutation(
      subscriptionMutationOptions.updateUsageLimit(queryClient)
    )
    const updateOrgLimitMutation = useMutation(
      organizationMutationOptions.updateUsageLimit(queryClient)
    )

    const isPending =
      context === 'organization'
        ? updateOrgLimitMutation.isPending
        : updateUserLimitMutation.isPending

    const handleStartEdit = () => {
      if (!editable || isPending) return
      setErrorType(null)
      setIsEditing(true)
      setInputValue(currentLimit ?? '')
    }

    useImperativeHandle(
      ref,
      () => ({
        startEdit: handleStartEdit,
      }),
      [editable, currentLimit, isPending]
    )

    useEffect(() => {
      setInputValue(currentLimit ?? '')
    }, [currentLimit])

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [isEditing])

    const handleSubmit = async () => {
      if (submitLockRef.current || isPending) return

      if (!editable) return
      let newLimit: string
      try {
        newLimit = monetary(inputValue)
      } catch {
        setInputValue(currentLimit ?? '')
        setIsEditing(false)
        return
      }
      if (compareMoney(newLimit, minimumLimit!) < 0) {
        setInputValue(currentLimit ?? '')
        setIsEditing(false)
        return
      }
      if (compareMoney(newLimit, currentUsage!) < 0) {
        setErrorType('belowUsage')
        return
      }
      if (compareMoney(newLimit, currentLimit!) === 0) {
        setIsEditing(false)
        return
      }

      submitLockRef.current = true
      try {
        if (context === 'organization') {
          if (!organizationId) {
            logger.error('Organization ID is required for organization context')
            setErrorType('general')
            return
          }

          await updateOrgLimitMutation.mutateAsync({ organizationId, limit: newLimit })
        } else {
          await updateUserLimitMutation.mutateAsync({ limit: newLimit })
        }

        setInputValue(newLimit)
        setIsEditing(false)
        setErrorType(null)
      } catch (err) {
        logger.error('Failed to update usage limit', { error: err })

        const message = err instanceof Error ? err.message : String(err)
        setErrorType(message.includes('below current usage') ? 'belowUsage' : 'general')

        setInputValue(currentLimit ?? '')
      } finally {
        submitLockRef.current = false
      }
    }

    const handleCancelEdit = () => {
      setIsEditing(false)
      setInputValue(currentLimit ?? '')
      setErrorType(null)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    }

    return (
      <div className='space-y-1'>
        <div className='flex items-center'>
          {isEditing ? (
            <>
              <span className='text-muted-foreground text-xs tabular-nums'>$</span>
              <input
                ref={inputRef}
                type='text'
                inputMode='decimal'
                aria-label={t('edit')}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  setErrorType(null)
                }}
                onKeyDown={handleKeyDown}
                onBlur={(e) => {
                  const relatedTarget = e.relatedTarget as HTMLElement
                  if (relatedTarget?.closest('button')) {
                    return
                  }
                  void handleSubmit()
                }}
                className={cn(
                  'border-0 bg-transparent p-0 text-xs tabular-nums',
                  'outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                  hasError && 'text-red-500'
                )}
                disabled={isPending}
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck='false'
                style={{ width: `${Math.min(24, Math.max(3, inputValue.length))}ch` }}
              />
            </>
          ) : (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {formatUsd(locale, currentLimit)}
            </span>
          )}
          {editable && (
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'ml-1 h-4 w-4 p-0 transition-colors hover:bg-transparent',
                hasError
                  ? 'text-red-500 hover:text-red-600'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={isEditing ? handleSubmit : handleStartEdit}
              disabled={isPending}
              focusableWhenDisabled={isPending}
              aria-busy={isPending || undefined}
            >
              {isPending ? (
                <LoaderCircle className='!h-3 !w-3 animate-spin' />
              ) : isEditing ? (
                hasError ? (
                  <X className='!h-3 !w-3' />
                ) : (
                  <Check className='!h-3 !w-3' />
                )
              ) : (
                <Pencil className='!h-3 !w-3' />
              )}
              <span className='sr-only'>
                {isPending ? t('saving') : isEditing ? t('save') : t('edit')}
              </span>
            </Button>
          )}
        </div>
        {hasError ? (
          <p role='alert' className='text-destructive text-xs'>
            {errorType === 'belowUsage' ? t('belowUsage') : t('updateFailed')}
          </p>
        ) : null}
      </div>
    )
  }
)

UsageLimit.displayName = 'UsageLimit'
