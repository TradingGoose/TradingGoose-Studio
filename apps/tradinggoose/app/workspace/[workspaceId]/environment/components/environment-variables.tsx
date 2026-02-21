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
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { createLogger } from '@/lib/logs/console/logger'
import {
  environmentKeys,
  useRemovePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useUpsertPersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import type { EnvironmentVariable } from '@/stores/settings/environment/types'

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

const formatDateTime = (value?: string | null): string => {
  if (!value) return '—'

  try {
    return new Intl.DateTimeFormat('en', {
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

const rowsToRecord = (rows: Row[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.key, row.value]))

const applyWorkspaceCachePatch = (
  data: WorkspaceEnvironmentData,
  scope: Scope,
  action:
    | { type: 'upsert'; originalKey: string; nextKey: string; value: string }
    | { type: 'delete'; key: string }
) => {
  const workspaceRows = [...data.workspaceRows]
  const personalRows = [...data.personalRows]
  const targetRows = scope === 'workspace' ? workspaceRows : personalRows
  const now = new Date().toISOString()

  let nextTargetRows = targetRows
  if (action.type === 'upsert') {
    const existing = targetRows.find(
      (row) => row.key === action.originalKey || row.key === action.nextKey
    )
    const createdAt =
      action.originalKey && action.originalKey === action.nextKey
        ? (existing?.createdAt ?? now)
        : now

    nextTargetRows = targetRows.filter(
      (row) => row.key !== action.originalKey && row.key !== action.nextKey
    )
    nextTargetRows.push({
      key: action.nextKey,
      value: action.value,
      createdAt,
      updatedAt: now,
    })
  } else {
    nextTargetRows = targetRows.filter((row) => row.key !== action.key)
  }

  const nextWorkspaceRows = scope === 'workspace' ? nextTargetRows : workspaceRows
  const nextPersonalRows = scope === 'personal' ? nextTargetRows : personalRows
  const workspaceKeySet = new Set(nextWorkspaceRows.map((row) => row.key))
  const conflicts = nextPersonalRows.map((row) => row.key).filter((key) => workspaceKeySet.has(key))

  return {
    ...data,
    workspace: rowsToRecord(nextWorkspaceRows),
    personal: rowsToRecord(nextPersonalRows),
    workspaceRows: nextWorkspaceRows,
    personalRows: nextPersonalRows,
    conflicts,
  }
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
  const queryClient = useQueryClient()
  const { data, isPending: isWorkspaceLoading } = useWorkspaceEnvironment(workspaceId)
  const upsertWorkspaceMutation = useUpsertWorkspaceEnvironment()
  const removeWorkspaceMutation = useRemoveWorkspaceEnvironment()
  const upsertPersonalMutation = useUpsertPersonalEnvironment()
  const removePersonalMutation = useRemovePersonalEnvironment()

  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [revealedValues, setRevealedValues] = useState<Record<string, boolean>>({})
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const editValueInputRef = useRef<HTMLInputElement | null>(null)

  const isMutating =
    upsertWorkspaceMutation.isPending ||
    removeWorkspaceMutation.isPending ||
    upsertPersonalMutation.isPending ||
    removePersonalMutation.isPending

  const isBusy = isWorkspaceLoading || isMutating

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

  const upsertVariable = async (scope: Scope, key: string, value: string) => {
    if (scope === 'workspace') {
      await upsertWorkspaceMutation.mutateAsync({ workspaceId, variables: { [key]: value } })
      return
    }

    await upsertPersonalMutation.mutateAsync({ key, value })
  }

  const removeVariable = async (scope: Scope, key: string) => {
    if (scope === 'workspace') {
      await removeWorkspaceMutation.mutateAsync({ workspaceId, keys: [key] })
      return
    }

    await removePersonalMutation.mutateAsync({ key })
  }

  const addVariable = (scope?: Scope) => {
    const targetScope = scope ?? keyScope
    const now = new Date().toISOString()

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
    setDraft(null)
  }

  const saveEditingRow = async () => {
    if (!draft || isMutating) return

    const nextKey = draft.key.trim()
    if (!nextKey || !draft.value) return

    try {
      await upsertVariable(draft.scope, nextKey, draft.value)

      if (draft.originalKey && draft.originalKey !== nextKey) {
        await removeVariable(draft.scope, draft.originalKey)
      }

      queryClient.setQueryData(
        environmentKeys.workspace(workspaceId),
        (current: WorkspaceEnvironmentData | undefined) =>
          current
            ? applyWorkspaceCachePatch(current, draft.scope, {
              type: 'upsert',
              originalKey: draft.originalKey,
              nextKey,
              value: draft.value,
            })
            : current
      )

      if (draft.scope === 'personal') {
        queryClient.setQueryData(
          environmentKeys.personal(),
          (current: Record<string, EnvironmentVariable> | undefined) => {
            const next = { ...(current ?? {}) }
            if (draft.originalKey && draft.originalKey !== nextKey) {
              delete next[draft.originalKey]
            }
            next[nextKey] = { key: nextKey, value: draft.value }
            return next
          }
        )
      }

      setDraft(null)
    } catch (error) {
      logger.error('Failed to save environment variable:', error)
    }
  }

  const deleteRow = async (scope: Scope, row: RenderRow) => {
    if (isMutating) return

    if (row.isEditing && draft?.isNew && draft.scope === scope && !row.originalKey) {
      setDraft(null)
      return
    }

    const keyToDelete = row.originalKey || row.key
    if (!keyToDelete) return

    try {
      await removeVariable(scope, keyToDelete)

      queryClient.setQueryData(
        environmentKeys.workspace(workspaceId),
        (current: WorkspaceEnvironmentData | undefined) =>
          current
            ? applyWorkspaceCachePatch(current, scope, {
              type: 'delete',
              key: keyToDelete,
            })
            : current
      )

      if (scope === 'personal') {
        queryClient.setQueryData(
          environmentKeys.personal(),
          (current: Record<string, EnvironmentVariable> | undefined) => {
            if (!current) return current
            if (!(keyToDelete in current)) return current
            const next = { ...current }
            delete next[keyToDelete]
            return next
          }
        )
      }

      if (draft?.scope === scope && draft.originalKey === keyToDelete) {
        setDraft(null)
      }
    } catch (error) {
      logger.error('Failed to delete environment variable:', error)
    }
  }

  const toggleReveal = (rowId: string) => {
    setRevealedValues((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
  }

  const copyValue = async (value: string, rowId: string) => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopiedRowId(rowId)
      setTimeout(() => setCopiedRowId(null), 1800)
    } catch (error) {
      logger.error('Failed to copy environment variable:', error)
    }
  }

  const scopeLabel = keyScope === 'workspace' ? 'Workspace' : 'Personal'

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
            <p className='font-medium text-lg'>No {scopeLabel.toLowerCase()} variables yet</p>
            <p className='mt-2 text-muted-foreground'>Create one to start configuring.</p>
            <Button className='mt-6' onClick={() => addVariable(keyScope)}>
              <Plus className='mr-2 h-4 w-4' />
              Create {scopeLabel} Environment Variable
            </Button>
          </td>
        </tr>
      )
    }

    if (searchTerm.trim() && filteredRows.length === 0) {
      return (
        <tr>
          <td colSpan={5} className='px-4 py-12 text-center text-muted-foreground'>
            No {scopeLabel.toLowerCase()} environment variables found matching "{searchTerm}".
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
            {formatDateTime(row.createdAt)}
          </td>

          <td className='px-4 py-2 align-middle'>
            {row.isEditing ? (
              <Input
                value={draft?.key ?? ''}
                onChange={(event) =>
                  setDraft((prev) => (prev ? { ...prev, key: event.target.value } : prev))
                }
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
                <p className='font-medium text-sm'>{row.key || 'Untitled variable'}</p>
                {hasWorkspaceConflict && (
                  <p className='text-destructive text-xs'>Overridden by workspace variable</p>
                )}
              </div>
            )}
          </td>

          <td className='px-4 py-2 align-middle'>
            {row.isEditing ? (
              <Input
                ref={(element) => {
                  if (row.isEditing) editValueInputRef.current = element
                }}
                value={draft?.value ?? ''}
                onChange={(event) =>
                  setDraft((prev) => (prev ? { ...prev, value: event.target.value } : prev))
                }
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
                  disabled={!row.value}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => toggleReveal(row.id)}
                >
                  {isRevealed ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                  <span className='sr-only'>{isRevealed ? 'Hide value' : 'Reveal value'}</span>
                </Button>
                <div className='min-w-0 flex-1 rounded-md bg-muted/70 px-3 py-2'>
                  <code className='block truncate font-mono text-xs'>{displayValue}</code>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  disabled={!row.value}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => {
                    void copyValue(row.value, row.id)
                  }}
                >
                  {isCopied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                  <span className='sr-only'>Copy environment value</span>
                </Button>
              </div>
            )}
          </td>

          <td className='px-4 py-2 align-middle text-muted-foreground text-sm'>
            {formatDateTime(row.updatedAt ?? row.createdAt)}
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
                    disabled={!draft?.key.trim() || !draft?.value || isMutating}
                    onClick={() => {
                      void saveEditingRow()
                    }}
                  >
                    <Check className='h-4 w-4' />
                    <span className='sr-only'>Save environment variable</span>
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    onClick={cancelEditing}
                  >
                    <X className='h-4 w-4' />
                    <span className='sr-only'>Cancel editing</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    onClick={() => startEditingRow(keyScope, row)}
                  >
                    <Pencil className='h-4 w-4' />
                    <span className='sr-only'>Edit environment variable</span>
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-destructive'
                    onClick={() => {
                      void deleteRow(keyScope, row)
                    }}
                  >
                    <Trash2 className='h-4 w-4' />
                    <span className='sr-only'>Delete environment variable</span>
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
                  Created At
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  Variable
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>Value</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  Updated At
                </span>
              </th>
              <th className='px-4 pt-2 pb-3 text-right font-medium'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  Actions
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
