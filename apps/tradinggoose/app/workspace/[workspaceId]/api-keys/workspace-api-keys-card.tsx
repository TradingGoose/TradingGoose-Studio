'use client'

import {
  forwardRef,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, Copy, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription, Button, Input, Label, Skeleton } from '@/components/ui'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type ApiKey,
  apiKeysKeys,
  createApiKey,
  deleteApiKey,
  renameWorkspaceApiKey,
  usePersonalApiKeys,
  useWorkspaceApiKeys,
} from '@/hooks/queries/api-keys'
import type { LocaleCode } from '@/i18n/utils'

interface WorkspaceApiKeysCardProps {
  workspaceId: string
  keyScope: 'workspace' | 'personal'
  searchTerm: string
  onBusyChange: (isBusy: boolean) => void
}

export interface WorkspaceApiKeysCardHandle {
  openCreateDialog: () => void
}

function ApiKeyDisplay({ value }: { value: string }) {
  return (
    <div className='flex h-9 items-center justify-center rounded-md bg-muted/70 px-3 text-center'>
      <code className='truncate font-mono text-xs'>{value || '—'}</code>
    </div>
  )
}

type ApiKeyWrite =
  | { kind: 'create'; workspaceId: string; name: string; keyType: 'personal' | 'workspace' }
  | { kind: 'rename'; workspaceId: string; keyId: string; name: string }
  | { kind: 'delete'; workspaceId: string; keyId: string; keyType: 'personal' | 'workspace' }

const WorkspaceApiKeysCardComponent = (
  { workspaceId, searchTerm, onBusyChange, keyScope }: WorkspaceApiKeysCardProps,
  ref: Ref<WorkspaceApiKeysCardHandle>
) => {
  const locale = useLocale() as LocaleCode
  const t = useTranslations('workspace.apiKeys')
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const queryClient = useQueryClient()
  const writeLockRef = useRef(false)
  const scope = keyScope
  const isWorkspaceScope = scope === 'workspace'
  const scopeLabel = isWorkspaceScope ? t('scope.workspace') : t('scope.personal')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyName, setEditingKeyName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const editKeyNameInputRef = useRef<HTMLInputElement | null>(null)
  const workspaceKeysQuery = useWorkspaceApiKeys(workspaceId)
  const personalKeysQuery = usePersonalApiKeys()
  const activeKeysQuery = isWorkspaceScope ? workspaceKeysQuery : personalKeysQuery
  const { data: apiKeys = [], isPending: isLoading, error: apiKeysError } = activeKeysQuery
  const writeMutation = useMutation({
    mutationFn: (operation: ApiKeyWrite) => {
      if (operation.kind === 'create') return createApiKey(operation)
      if (operation.kind === 'rename') return renameWorkspaceApiKey(operation)
      return deleteApiKey(operation)
    },
    onSuccess: async (_result, operation) => {
      const operationScope = operation.kind === 'rename' ? 'workspace' : operation.keyType
      if (operationScope === 'workspace') {
        await queryClient.invalidateQueries({
          queryKey: apiKeysKeys.workspace(operation.workspaceId),
        })
      } else {
        await queryClient.invalidateQueries({ queryKey: apiKeysKeys.personal() })
      }
    },
  })
  const isWriting = writeMutation.isPending
  const loadError = apiKeysError ? t('labels.failedLoad') : null
  const isSubmittingCreate = isWriting && writeMutation.variables?.kind === 'create'
  const isSubmittingDelete = isWriting && writeMutation.variables?.kind === 'delete'

  const canManageKeys = isWorkspaceScope ? canManageWorkspaceKeys : true
  const canRenameKeys = isWorkspaceScope && canManageWorkspaceKeys
  const canDeleteKeys = canManageKeys

  const filteredKeys = useMemo(() => {
    if (!searchTerm.trim()) return apiKeys
    return apiKeys.filter((key) => key.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [apiKeys, searchTerm])

  useEffect(() => {
    onBusyChange(isLoading || isWriting)
  }, [isLoading, isWriting, onBusyChange])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (editingKeyId && editKeyNameInputRef.current) {
      editKeyNameInputRef.current.focus()
      editKeyNameInputRef.current.select()
    }
  }, [editingKeyId])

  useImperativeHandle(
    ref,
    () => ({
      openCreateDialog: () => {
        if (writeLockRef.current) return
        setCreateError(null)
        setIsCreateDialogOpen(true)
      },
    }),
    []
  )

  const formatDate = (dateString?: string) => {
    if (!dateString) return t('labels.never')
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const startEditingKey = useCallback(
    (key: ApiKey) => {
      if (!canRenameKeys) return
      setEditingKeyId(key.id)
      setEditingKeyName(key.name)
      setRenameError(null)
    },
    [canRenameKeys]
  )

  const cancelEditingKey = useCallback(() => {
    setEditingKeyId(null)
    setEditingKeyName('')
    setRenameError(null)
  }, [])

  useEffect(() => {
    if (!canRenameKeys) {
      cancelEditingKey()
    }
  }, [canRenameKeys, cancelEditingKey])

  const commitEditingKey = useCallback(async () => {
    if (!editingKeyId || !canRenameKeys || writeLockRef.current) return
    const trimmedName = editingKeyName.trim()
    if (!trimmedName) {
      setRenameError(t('labels.nameRequired'))
      editKeyNameInputRef.current?.focus()
      return
    }
    writeLockRef.current = true
    setRenameError(null)
    try {
      await writeMutation.mutateAsync({
        kind: 'rename',
        workspaceId,
        keyId: editingKeyId,
        name: trimmedName,
      })
      cancelEditingKey()
    } catch {
      setRenameError(t('labels.unableRename', { scope: scopeLabel }))
      editKeyNameInputRef.current?.focus()
    } finally {
      writeLockRef.current = false
    }
  }, [
    cancelEditingKey,
    canRenameKeys,
    editingKeyId,
    editingKeyName,
    scopeLabel,
    t,
    workspaceId,
    writeMutation,
  ])

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || writeLockRef.current) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = apiKeys.some((key) => key.name === trimmedName)
    if (isDuplicate) {
      setCreateError(t('labels.duplicateName', { scope: scopeLabel, name: trimmedName }))
      return
    }

    writeLockRef.current = true
    setCreateError(null)
    try {
      const data = (await writeMutation.mutateAsync({
        kind: 'create',
        workspaceId,
        name: trimmedName,
        keyType: isWorkspaceScope ? 'workspace' : 'personal',
      })) as { key: ApiKey }

      setNewKey(data.key)
      setShowNewKeyDialog(true)
      setIsCreateDialogOpen(false)
      setNewKeyName('')
    } catch {
      setCreateError(t('labels.failedCreate', { scope: scopeLabel }))
    } finally {
      writeLockRef.current = false
    }
  }

  const handleDeleteKey = async () => {
    if (!deleteKey || writeLockRef.current) return

    writeLockRef.current = true
    setDeleteError(null)
    try {
      await writeMutation.mutateAsync({
        kind: 'delete',
        workspaceId,
        keyId: deleteKey.id,
        keyType: isWorkspaceScope ? 'workspace' : 'personal',
      })
      setShowDeleteDialog(false)
      setDeleteKey(null)
      setDeleteConfirmationName('')
    } catch {
      setDeleteError(t('labels.failedDelete', { scope: scopeLabel }))
    } finally {
      writeLockRef.current = false
    }
  }

  const copyToClipboard = (key: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    void navigator.clipboard
      .writeText(key)
      .then(() => {
        setCopySuccess(true)
        if (copyTimeoutRef.current) {
          clearTimeout(copyTimeoutRef.current)
        }
        copyTimeoutRef.current = setTimeout(() => setCopySuccess(false), 1500)
      })
      .catch(() => setCopySuccess(false))
  }

  const renderTableView = () => {
    const renderTableRows = () => {
      if (isLoading) {
        return [0, 1, 2].map((row) => (
          <tr key={`loading-${row}`} className='border-b'>
            <td className='px-4 py-4'>
              <Skeleton className='mx-auto h-4 w-20' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='h-3 w-1/3' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='h-9 w-full max-w-sm rounded-md' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='mx-auto h-3 w-24' />
            </td>
            <td className='px-4 py-4'>
              <div className='flex justify-end gap-2'>
                <Skeleton className='h-8 w-8 rounded-full' />
                <Skeleton className='h-8 w-8 rounded-full' />
                <Skeleton className='h-8 w-8 rounded-full' />
              </div>
            </td>
          </tr>
        ))
      }

      if (apiKeys.length === 0) {
        return (
          <tr>
            <td colSpan={5} className='px-4 py-12 text-center'>
              <p className='font-medium text-lg'>{t(`emptyState.${scope}.title`)}</p>
              <p className='mt-2 text-muted-foreground'>{t(`emptyState.${scope}.description`)}</p>
              {canManageKeys && (
                <Button
                  className='mt-6'
                  disabled={isWriting}
                  onClick={() => {
                    setIsCreateDialogOpen(true)
                    setCreateError(null)
                  }}
                >
                  <Plus className='mr-2 h-4 w-4' />
                  {t(`emptyState.${scope}.button`)}
                </Button>
              )}
            </td>
          </tr>
        )
      }

      if (searchTerm.trim() && filteredKeys.length === 0) {
        return (
          <tr>
            <td colSpan={5} className='px-4 py-12 text-center text-muted-foreground'>
              {t('searchEmpty', { scope: scopeLabel, query: searchTerm })}
            </td>
          </tr>
        )
      }

      return filteredKeys.map((key) => {
        const isEditing = canRenameKeys && editingKeyId === key.id

        return (
          <tr key={key.id} className='border-b transition-colors hover:bg-card/30'>
            <td className='px-4 py-4 text-center text-muted-foreground text-sm'>
              {formatDate(key.createdAt)}
            </td>
            <td className='px-4 py-4 align-middle'>
              {canRenameKeys && editingKeyId === key.id ? (
                <div className='space-y-2'>
                  <div className='flex max-w-sm items-center gap-2'>
                    <Input
                      aria-label={t('labels.rename', { scope: scopeLabel })}
                      ref={(el) => {
                        if (editingKeyId === key.id) {
                          editKeyNameInputRef.current = el
                        }
                      }}
                      value={editingKeyName}
                      onChange={(event) => setEditingKeyName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void commitEditingKey()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditingKey()
                        }
                      }}
                      disabled={isWriting}
                      className='h-8 flex-1'
                      autoComplete='off'
                    />
                  </div>
                  {renameError && editingKeyId === key.id && (
                    <p className='text-destructive text-xs'>{renameError}</p>
                  )}
                </div>
              ) : (
                <div className='text-center'>
                  <p className='font-medium text-sm'>{key.name}</p>
                </div>
              )}
            </td>
            <td className='px-4 py-4'>
              <div className='flex flex-wrap items-center gap-2 md:flex-nowrap'>
                <div className='min-w-0 flex-1'>
                  <ApiKeyDisplay value={key.displayKey || '—'} />
                </div>
              </div>
            </td>
            <td className='px-4 py-4 text-center text-muted-foreground text-sm'>
              {formatDate(key.lastUsed)}
            </td>
            <td className='px-4 py-4'>
              <div className='flex items-center justify-center gap-1.5'>
                {isEditing ? (
                  <>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      disabled={isWriting}
                      className='h-8 w-8 text-muted-foreground'
                      onClick={() => void commitEditingKey()}
                    >
                      <Check className='h-4 w-4' />
                      <span className='sr-only'>{t('labels.save', { scope: scopeLabel })}</span>
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      disabled={isWriting}
                      className='h-8 w-8 text-muted-foreground'
                      onClick={cancelEditingKey}
                    >
                      <X className='h-4 w-4' />
                      <span className='sr-only'>{t('labels.cancelRename')}</span>
                    </Button>
                  </>
                ) : (
                  <>
                    {canRenameKeys && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        disabled={!canRenameKeys || isWriting}
                        className='h-8 w-8 text-muted-foreground'
                        onClick={() => startEditingKey(key)}
                      >
                        <Pencil className='h-4 w-4' />
                        <span className='sr-only'>{t('labels.rename', { scope: scopeLabel })}</span>
                      </Button>
                    )}
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      disabled={!canDeleteKeys || isWriting}
                      className='h-8 w-8 text-destructive'
                      onClick={() => {
                        setDeleteError(null)
                        setDeleteKey(key)
                        setShowDeleteDialog(true)
                      }}
                    >
                      <Trash2 className='h-4 w-4' />
                      <span className='sr-only'>{t('labels.delete', { scope: scopeLabel })}</span>
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
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
        <div className='shrink-0 overflow-x-auto border-b bg-muted/40'>
          <table className='w-full min-w-[960px] table-fixed'>
            <colgroup>
              <col className='w-[10%]' />
              <col className='w-[20%]' />
              <col className='w-[40%]' />
              <col className='w-[10%]' />
              <col className='w-[20%]' />
            </colgroup>
            <thead>
              <tr>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    {t('headers.createdAt')}
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    {t('headers.name')}
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    {t('headers.key')}
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    {t('headers.lastUpdate')}
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    {t('headers.actions')}
                  </span>
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <div className='min-h-0 flex-1 overflow-auto' style={{ scrollbarGutter: 'stable' }}>
          <table className='w-full min-w-[960px] table-fixed'>
            <colgroup>
              <col className='w-[10%]' />
              <col className='w-[20%]' />
              <col className='w-[40%]' />
              <col className='w-[10%]' />
              <col className='w-[20%]' />
            </colgroup>
            <tbody>{renderTableRows()}</tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    if (loadError) {
      return (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )
    }

    return renderTableView()
  }

  const content = renderContent()

  const permissionNotice =
    isWorkspaceScope && !canManageKeys ? (
      <div className='px-1 pt-3 text-muted-foreground text-xs'>
        {t('labels.workspacePermissions')}
      </div>
    ) : null

  return (
    <>
      <div className='flex h-full min-h-0 flex-1 flex-col'>
        {content}
        {permissionNotice}
      </div>

      <AlertDialog
        open={isCreateDialogOpen}
        onOpenChange={(open, details) => {
          if (!open && isSubmittingCreate) return details.cancel()
          setIsCreateDialogOpen(open)
        }}
      >
        <AlertDialogContent hideCloseButton={isSubmittingCreate} className='rounded-md sm:max-w-lg'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogs.createTitle', { scope: scopeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {isWorkspaceScope ? t('labels.workspaceAccess') : t('labels.personalAccess')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className='space-y-2'>
            <Label htmlFor='api-key-create-name'>{t('dialogs.createNameLabel')}</Label>
            <Input
              id='api-key-create-name'
              autoFocus
              disabled={isSubmittingCreate}
              aria-invalid={Boolean(createError)}
              aria-describedby={createError ? 'api-key-create-error' : undefined}
              placeholder={t('dialogs.createNamePlaceholder')}
              value={newKeyName}
              onChange={(e) => {
                setNewKeyName(e.target.value)
                if (createError) setCreateError(null)
              }}
            />
            {createError ? (
              <p id='api-key-create-error' role='alert' className='text-red-600 text-sm'>
                {createError}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='w-full rounded-sm'
              disabled={isSubmittingCreate}
              onClick={() => {
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              {t('dialogs.cancel')}
            </AlertDialogCancel>
            <Button
              type='button'
              className='w-full rounded-sm'
              disabled={!newKeyName.trim() || isSubmittingCreate}
              aria-busy={isSubmittingCreate || undefined}
              onClick={() => void handleCreateKey()}
            >
              {isSubmittingCreate ? (
                <>
                  <Loader2 data-icon='inline-start' className='animate-spin' />
                  {t('dialogs.creating')}
                </>
              ) : (
                t('dialogs.createButton')
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog((prev) => (prev === open ? prev : open))
          if (!open) {
            setNewKey(null)
            setCopySuccess(false)
          }
        }}
      >
        <AlertDialogContent className='rounded-md sm:max-w-lg'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogs.newKeyTitle', { scope: scopeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialogs.newKeyDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {newKey && (
            <div className='relative'>
              <div className='flex h-10 items-center rounded-md bg-muted px-3 pr-10'>
                <code className='flex-1 truncate font-mono text-sm'>{newKey.key || '—'}</code>
              </div>
              <Button
                variant='ghost'
                size='icon'
                disabled={!newKey.key}
                aria-label={t('dialogs.copyToClipboard')}
                className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 rounded-sm text-muted-foreground hover:bg-card hover:text-foreground'
                onClick={() => {
                  if (newKey.key) copyToClipboard(newKey.key)
                }}
              >
                {copySuccess ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
              </Button>
            </div>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open, details) => {
          if (!open && isSubmittingDelete) return details.cancel()
          setShowDeleteDialog(open)
        }}
      >
        <AlertDialogContent hideCloseButton={isSubmittingDelete} className='rounded-md sm:max-w-lg'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogs.deleteTitle', { scope: scopeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialogs.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {deleteKey && (
            <div className='py-2'>
              <Label htmlFor='api-key-delete-confirmation' className='mb-2'>
                {t('dialogs.deletePrompt', { name: deleteKey.name })}
              </Label>
              <Input
                id='api-key-delete-confirmation'
                autoFocus
                disabled={isSubmittingDelete}
                aria-invalid={Boolean(deleteError)}
                aria-describedby={deleteError ? 'api-key-delete-error' : undefined}
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder={t('dialogs.deletePlaceholder')}
              />
            </div>
          )}

          {deleteError ? (
            <Alert variant='destructive' aria-atomic='true'>
              <AlertDescription id='api-key-delete-error'>{deleteError}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='w-full rounded-sm'
              disabled={isSubmittingDelete}
              onClick={() => {
                setDeleteKey(null)
                setDeleteConfirmationName('')
                setDeleteError(null)
              }}
            >
              {t('dialogs.cancel')}
            </AlertDialogCancel>
            <Button
              type='button'
              className='w-full rounded-sm bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={
                !deleteKey || deleteConfirmationName !== deleteKey.name || isSubmittingDelete
              }
              aria-busy={isSubmittingDelete || undefined}
              onClick={() => void handleDeleteKey()}
            >
              {isSubmittingDelete ? (
                <>
                  <Loader2 data-icon='inline-start' className='animate-spin' />
                  {t('dialogs.deleting')}
                </>
              ) : (
                t('dialogs.deleteButton')
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export const WorkspaceApiKeysCard = forwardRef(WorkspaceApiKeysCardComponent)
WorkspaceApiKeysCard.displayName = 'WorkspaceApiKeysCard'
