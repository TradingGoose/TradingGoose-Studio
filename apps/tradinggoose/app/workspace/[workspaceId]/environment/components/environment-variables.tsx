'use client'

import {
  forwardRef,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { deleteEnvironmentVariable, saveEnvironmentVariable } from '@/lib/environment/api'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshEnvironmentQueries, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { usePathname } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'

type Scope = 'workspace' | 'personal'

interface Row {
  key: string
  value: string
  createdAt?: string | null
  updatedAt?: string | null
}

interface DraftRow extends Row {
  scope: Scope
  originalKey: string
  isNew: boolean
}

interface RenderRow extends Row {
  id: string
  originalKey: string
  isEditing: boolean
}

type EnvironmentWrite =
  | {
      kind: 'save'
      scope: Scope
      originalKey: string | null
      key: string
      value: string
    }
  | {
      kind: 'delete'
      scope: Scope
      key: string
    }

type EnvironmentWriteSummary = Pick<EnvironmentWrite, 'kind' | 'scope' | 'key'>

type EnvironmentFailure = EnvironmentWriteSummary & {
  phase: 'transport' | 'refresh'
}

interface EnvironmentVariablesProps {
  workspaceId: string
  searchTerm?: string
  keyScope?: Scope
  onLoadingChange?: (isLoading: boolean) => void
}

export interface EnvironmentVariablesHandle {
  addVariable: (scope?: Scope) => void
}

const logger = createLogger('EnvironmentVariables')

const formatDateTime = (locale: LocaleCode, value?: string | null): string => {
  if (!value) return '—'

  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return '—'
  }
}

const maskValue = (value: string): string => {
  if (!value) return ''

  const prefixLength = Math.min(4, value.length)
  const suffixLength = Math.min(4, value.length - prefixLength)
  const maskedLength = Math.max(value.length - (prefixLength + suffixLength), 3)

  return `${value.slice(0, prefixLength)}${'.'.repeat(maskedLength)}${value.slice(value.length - suffixLength)}`
}

const buildRowsForScope = (rows: Row[], draft: DraftRow | null, scope: Scope): RenderRow[] => {
  const baseRows: RenderRow[] = rows.map((row) => ({
    id: row.key,
    originalKey: row.key,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isEditing: false,
  }))

  if (!draft || draft.scope !== scope) {
    return baseRows
  }

  if (draft.isNew) {
    return [
      ...baseRows,
      {
        id: '__new__',
        originalKey: '',
        key: draft.key,
        value: draft.value,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        isEditing: true,
      },
    ]
  }

  return baseRows.map((row) =>
    row.originalKey === draft.originalKey
      ? {
          ...row,
          key: draft.key,
          value: draft.value,
          createdAt: draft.createdAt ?? row.createdAt,
          updatedAt: draft.updatedAt ?? row.updatedAt,
          isEditing: true,
        }
      : row
  )
}

const EnvironmentVariablesComponent = (
  {
    workspaceId,
    searchTerm = '',
    keyScope = 'workspace',
    onLoadingChange,
  }: EnvironmentVariablesProps,
  ref: Ref<EnvironmentVariablesHandle>
) => {
  const locale = useLocale() as LocaleCode
  const t = useTranslations('workspace.environment')
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const {
    data,
    isPending: isWorkspaceLoading,
    isPlaceholderData,
  } = useWorkspaceEnvironment(workspaceId)

  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [writeError, setWriteError] = useState<EnvironmentFailure | null>(null)
  const [isRefreshPending, setIsRefreshPending] = useState(false)
  const [revealedValues, setRevealedValues] = useState<Record<string, boolean>>({})
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const editValueInputRef = useRef<HTMLInputElement | null>(null)
  const writeLockRef = useRef(false)
  const environmentMutation = useMutation({
    mutationFn: (write: EnvironmentWrite) => {
      const target =
        write.scope === 'workspace'
          ? { scope: write.scope, workspaceId, callbackPathname: pathname }
          : { scope: write.scope, callbackPathname: pathname }

      return write.kind === 'save'
        ? saveEnvironmentVariable({
            ...target,
            originalKey: write.originalKey,
            key: write.key,
            value: write.value,
          })
        : deleteEnvironmentVariable({ ...target, key: write.key })
    },
    onSuccess: async (_data, write) => {
      setDraft((current) =>
        write.kind === 'save' ||
        (current?.scope === write.scope && current.originalKey === write.key)
          ? null
          : current
      )
      const result = await refreshEnvironmentQueries(queryClient, write.scope, workspaceId)
      if (!result.ok) {
        logger.error('Environment variable change committed but refresh failed:', result.error)
        setWriteError({ kind: write.kind, scope: write.scope, key: write.key, phase: 'refresh' })
      }
    },
  })
  const isRefreshRequired = writeError?.phase === 'refresh'
  const isPending = environmentMutation.isPending || isRefreshPending
  const controlsBlocked = isWorkspaceLoading || isPlaceholderData || isRefreshRequired
  const activeWrite = environmentMutation.isPending ? environmentMutation.variables : null
  const isBusy = controlsBlocked || isPending

  useEffect(() => {
    onLoadingChange?.(isBusy)
  }, [isBusy, onLoadingChange])

  const workspaceRows = data?.workspaceRows ?? []
  const personalRows = data?.personalRows ?? []
  const scopeRows = keyScope === 'workspace' ? workspaceRows : personalRows

  const rowsForScope = useMemo(
    () => buildRowsForScope(scopeRows, draft, keyScope),
    [scopeRows, draft, keyScope]
  )

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return rowsForScope
    return rowsForScope.filter((row) => row.key.toLowerCase().includes(term))
  }, [rowsForScope, searchTerm])

  const conflictSet = useMemo(() => new Set(data?.conflicts ?? []), [data?.conflicts])

  const focusEditor = (scrollToBottom = false) => {
    setTimeout(() => {
      editValueInputRef.current?.focus()
      if (scrollToBottom) {
        scrollContainerRef.current?.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth',
        })
      }
    }, 0)
  }

  const addVariable = (scope?: Scope) => {
    if (isBusy || writeLockRef.current) return

    const targetScope = scope ?? keyScope
    const now = new Date().toISOString()

    setWriteError(null)
    setDraft({
      scope: targetScope,
      originalKey: '',
      key: '',
      value: '',
      createdAt: now,
      updatedAt: now,
      isNew: true,
    })
    focusEditor(true)
  }

  useImperativeHandle(ref, () => ({ addVariable }))

  const startEditingRow = (scope: Scope, row: RenderRow) => {
    if (isBusy || writeLockRef.current) return

    setWriteError(null)
    setDraft({
      scope,
      originalKey: row.originalKey,
      key: row.key,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isNew: false,
    })
    focusEditor()
  }

  const cancelEditing = () => {
    if (isBusy || writeLockRef.current) return
    setWriteError(null)
    setDraft(null)
  }

  const runWrite = async (write: EnvironmentWrite) => {
    if (isBusy || writeLockRef.current) return

    const summary: EnvironmentWriteSummary = {
      kind: write.kind,
      scope: write.scope,
      key: write.key,
    }
    writeLockRef.current = true
    setWriteError(null)

    try {
      await environmentMutation.mutateAsync(write)
    } catch (error) {
      logger.error(`Failed to ${write.kind} environment variable:`, error)
      setWriteError({ ...summary, phase: 'transport' })
    } finally {
      writeLockRef.current = false
    }
  }

  const retryRefresh = async () => {
    if (writeError?.phase !== 'refresh' || writeLockRef.current) return

    writeLockRef.current = true
    setIsRefreshPending(true)
    try {
      const result = await refreshEnvironmentQueries(queryClient, writeError.scope, workspaceId)
      if (result.ok) {
        setWriteError(null)
      } else {
        logger.error('Failed to refresh environment variables:', result.error)
      }
    } finally {
      writeLockRef.current = false
      setIsRefreshPending(false)
    }
  }

  const saveEditingRow = () => {
    if (!draft || isBusy || writeLockRef.current) return

    const nextKey = draft.key.trim()
    if (!nextKey || !draft.value) return

    const write: EnvironmentWrite = {
      kind: 'save',
      scope: draft.scope,
      originalKey: draft.originalKey || null,
      key: nextKey,
      value: draft.value,
    }
    void runWrite(write)
  }

  const deleteRow = (scope: Scope, row: RenderRow) => {
    if (isBusy || writeLockRef.current) return

    if (row.isEditing && draft?.isNew && draft.scope === scope && !row.originalKey) {
      setDraft(null)
      return
    }

    const keyToDelete = row.originalKey || row.key
    if (!keyToDelete) return

    void runWrite({ kind: 'delete', scope, key: keyToDelete })
  }

  const toggleReveal = (rowId: string) => {
    if (isBusy || writeLockRef.current) return
    setRevealedValues((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
  }

  const copyValue = async (value: string, rowId: string) => {
    if (!value || isBusy || writeLockRef.current) return

    try {
      await navigator.clipboard.writeText(value)
      setCopiedRowId(rowId)
      setTimeout(() => setCopiedRowId(null), 1800)
    } catch (error) {
      logger.error('Failed to copy environment variable:', error)
    }
  }

  const renderRows = () => {
    if (isWorkspaceLoading && rowsForScope.length === 0) {
      return [0, 1, 2].map((index) => (
        <tr key={`loading-${index}`} className='border-b'>
          <td className='px-4 py-4'>
            <Skeleton className='h-4 w-3/4' />
          </td>
          <td className='px-4 py-4'>
            <Skeleton className='h-9 w-full rounded-md' />
          </td>
          <td className='px-4 py-4'>
            <Skeleton className='h-9 w-full rounded-md' />
          </td>
          <td className='px-4 py-4'>
            <Skeleton className='h-4 w-3/4' />
          </td>
          <td className='px-4 py-4'>
            <div className='flex justify-end gap-2'>
              <Skeleton className='h-8 w-8 rounded-full' />
              <Skeleton className='h-8 w-8 rounded-full' />
            </div>
          </td>
        </tr>
      ))
    }

    if (rowsForScope.length === 0) {
      return (
        <tr>
          <td colSpan={5} className='px-4 py-12 text-center'>
            <p className='font-medium text-lg'>{t(`emptyState.${keyScope}.title`)}</p>
            <p className='mt-2 text-muted-foreground'>{t(`emptyState.${keyScope}.description`)}</p>
            <Button className='mt-6' disabled={isBusy} onClick={() => addVariable(keyScope)}>
              <Plus className='mr-2 h-4 w-4' />
              {t(`create.${keyScope}`)}
            </Button>
          </td>
        </tr>
      )
    }

    if (searchTerm.trim() && filteredRows.length === 0) {
      return (
        <tr>
          <td colSpan={5} className='px-4 py-12 text-center text-muted-foreground'>
            {t(`searchEmpty.${keyScope}`, { query: searchTerm })}
          </td>
        </tr>
      )
    }

    return filteredRows.map((row) => {
      const hasWorkspaceConflict = keyScope === 'personal' && row.key && conflictSet.has(row.key)
      const isRevealed = Boolean(revealedValues[row.id])
      const isCopied = copiedRowId === row.id
      const displayValue = row.value ? (isRevealed ? row.value : maskValue(row.value)) : '—'

      return (
        <tr key={row.id} className='border-b transition-colors hover:bg-card/30'>
          <td className='px-4 py-2 align-middle text-muted-foreground text-sm'>
            {formatDateTime(locale, row.createdAt)}
          </td>

          <td className='px-4 py-2 align-middle'>
            {row.isEditing ? (
              <Input
                aria-label={t('headers.variable')}
                disabled={isBusy}
                value={draft?.key ?? ''}
                onChange={(event) => {
                  if (writeLockRef.current) return
                  setDraft((prev) => (prev ? { ...prev, key: event.target.value } : prev))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveEditingRow()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEditing()
                  }
                }}
                autoComplete='off'
                autoCapitalize='off'
                spellCheck='false'
                className='h-9'
              />
            ) : (
              <div className='space-y-1'>
                <p className='font-medium text-sm'>{row.key || t('labels.untitledVariable')}</p>
                {hasWorkspaceConflict && (
                  <p className='text-destructive text-xs'>
                    {t('labels.overriddenByWorkspaceVariable')}
                  </p>
                )}
              </div>
            )}
          </td>

          <td className='px-4 py-2 align-middle'>
            {row.isEditing ? (
              <Input
                aria-label={t('headers.value')}
                disabled={isBusy}
                ref={(element) => {
                  if (row.isEditing) editValueInputRef.current = element
                }}
                value={draft?.value ?? ''}
                onChange={(event) => {
                  if (writeLockRef.current) return
                  setDraft((prev) => (prev ? { ...prev, value: event.target.value } : prev))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveEditingRow()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEditing()
                  }
                }}
                autoComplete='off'
                autoCapitalize='off'
                spellCheck='false'
                className='h-9'
              />
            ) : (
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  disabled={!row.value || isBusy}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => toggleReveal(row.id)}
                >
                  {isRevealed ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                  <span className='sr-only'>
                    {isRevealed ? t('labels.hideValue') : t('labels.revealValue')}
                  </span>
                </Button>
                <div className='min-w-0 flex-1 rounded-md bg-muted/70 px-3 py-2'>
                  <code className='block truncate font-mono text-xs'>{displayValue}</code>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  disabled={!row.value || isBusy}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => {
                    void copyValue(row.value, row.id)
                  }}
                >
                  {isCopied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                  <span className='sr-only'>{t('labels.copyValue')}</span>
                </Button>
              </div>
            )}
          </td>

          <td className='px-4 py-2 align-middle text-muted-foreground text-sm'>
            {formatDateTime(locale, row.updatedAt ?? row.createdAt)}
          </td>

          <td className='px-4 py-2 align-middle'>
            <div className='flex items-center justify-end gap-1.5'>
              {row.isEditing ? (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    disabled={!draft?.key.trim() || !draft?.value || controlsBlocked || isPending}
                    aria-busy={
                      activeWrite?.kind === 'save' &&
                      activeWrite.scope === keyScope &&
                      activeWrite.key === draft?.key.trim()
                    }
                    onClick={() => {
                      void saveEditingRow()
                    }}
                  >
                    <Check className='h-4 w-4' />
                    <span className='sr-only'>{t('labels.save')}</span>
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    disabled={isBusy}
                    onClick={cancelEditing}
                  >
                    <X className='h-4 w-4' />
                    <span className='sr-only'>{t('labels.cancel')}</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    disabled={isBusy}
                    onClick={() => startEditingRow(keyScope, row)}
                  >
                    <Pencil className='h-4 w-4' />
                    <span className='sr-only'>{t('labels.edit')}</span>
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-destructive'
                    disabled={controlsBlocked || isPending}
                    aria-busy={
                      activeWrite?.kind === 'delete' &&
                      activeWrite.scope === keyScope &&
                      activeWrite.key === (row.originalKey || row.key)
                    }
                    onClick={() => {
                      void deleteRow(keyScope, row)
                    }}
                  >
                    <Trash2 className='h-4 w-4' />
                    <span className='sr-only'>{t('labels.delete')}</span>
                  </Button>
                </>
              )}
            </div>
          </td>
        </tr>
      )
    })
  }

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      {activeWrite && (
        <p
          role='status'
          aria-atomic='true'
          className='border-b bg-muted/30 px-4 py-2 text-muted-foreground text-sm'
        >
          {t(activeWrite.kind === 'save' ? 'status.saving' : 'status.deleting', {
            scope: t(`scope.${activeWrite.scope}`),
            key: activeWrite.key,
          })}
        </p>
      )}
      {writeError && (
        <div
          role='alert'
          aria-atomic='true'
          className='flex items-center justify-between gap-3 border-b bg-destructive/10 px-4 py-2 text-destructive text-sm'
        >
          <span>
            {t(writeError.phase === 'refresh' ? 'status.refreshRequired' : 'status.notConfirmed', {
              scope: t(`scope.${writeError.scope}`),
              key: writeError.key,
            })}
          </span>
          {writeError.phase === 'refresh' ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='shrink-0'
              disabled={isPending}
              aria-busy={isPending}
              onClick={() => {
                void retryRefresh()
              }}
            >
              {t('status.refresh')}
            </Button>
          ) : null}
        </div>
      )}
      <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full min-w-[960px] table-fixed'>
          <colgroup>
            <col className='w-[12%]' />
            <col className='w-[20%]' />
            <col className='w-[38%]' />
            <col className='w-[12%]' />
            <col className='w-[18%]' />
          </colgroup>
          <thead className='sticky top-0 z-10 border-b bg-muted/40'>
            <tr>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  {t('headers.createdAt')}
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  {t('headers.variable')}
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  {t('headers.value')}
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  {t('headers.updatedAt')}
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-right font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  {t('headers.actions')}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>{renderRows()}</tbody>
        </table>
      </div>
    </div>
  )
}

EnvironmentVariablesComponent.displayName = 'EnvironmentVariables'

export const EnvironmentVariables = forwardRef(EnvironmentVariablesComponent)
