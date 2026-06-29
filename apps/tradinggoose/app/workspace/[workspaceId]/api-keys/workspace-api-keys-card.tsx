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
import { AlertCircle, Check, Copy, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription, Button, Input, Label, Skeleton } from '@/components/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { type ApiKey, useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/hooks/queries/api-keys'
import type { LocaleCode } from '@/i18n/utils'

interface WorkspaceApiKeysCardProps {
  workspaceId?: string
  keyScope?: 'workspace' | 'personal'
  searchTerm?: string
  onSearchTermChange?: (value: string) => void
  hideHeader?: boolean
  variant?: 'card' | 'page'
  onLoadingChange?: (isLoading: boolean) => void
}

const logger = createLogger('WorkspaceApiKeysCard')

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

const WorkspaceApiKeysCardComponent = (
  {
    workspaceId,
    searchTerm: controlledSearchTerm,
    onSearchTermChange,
    hideHeader = false,
    variant = 'card',
    onLoadingChange,
    keyScope = 'workspace',
  }: WorkspaceApiKeysCardProps,
  ref: Ref<WorkspaceApiKeysCardHandle>
) => {
  const locale = useLocale() as LocaleCode
  const t = useTranslations('workspace.apiKeys')
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const scope = keyScope
  const isWorkspaceScope = scope === 'workspace'
  const scopeLabel = isWorkspaceScope ? t('scope.workspace') : t('scope.personal')
  const scopeDescription = isWorkspaceScope
    ? t('descriptions.workspace')
    : t('descriptions.personal')
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [internalSearchTerm, setInternalSearchTerm] = useState('')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyName, setEditingKeyName] = useState('')
  const [isUpdatingKeyName, setIsUpdatingKeyName] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const editKeyNameInputRef = useRef<HTMLInputElement | null>(null)
  const {
    data: apiKeysData,
    isPending: isApiKeysPending,
    error: apiKeysError,
    refetch: refetchApiKeys,
  } = useApiKeys(workspaceId ?? '')
  const createApiKeyMutation = useCreateApiKey()
  const deleteApiKeyMutation = useDeleteApiKey()

  useEffect(() => {
    if (!apiKeysData) {
      setApiKeys([])
      return
    }
    const scopedKeys = isWorkspaceScope ? apiKeysData.workspaceKeys : apiKeysData.personalKeys
    setApiKeys(scopedKeys || [])
  }, [apiKeysData, isWorkspaceScope])

  const loadError = apiKeysError instanceof Error ? apiKeysError.message : null
  const isLoading = isApiKeysPending
  const isSubmittingCreate = createApiKeyMutation.isPending

  const canManageKeys = isWorkspaceScope ? canManageWorkspaceKeys : true
  const canRenameKeys = isWorkspaceScope && canManageWorkspaceKeys
  const canDeleteKeys = canManageKeys

  const isCardVariant = variant === 'card'
  const shouldRenderHeader = isCardVariant && !hideHeader
  const resolvedSearchTerm = controlledSearchTerm ?? internalSearchTerm
  const handleSearchTermChange = onSearchTermChange ?? setInternalSearchTerm

  const filteredKeys = useMemo(() => {
    if (!resolvedSearchTerm.trim()) return apiKeys
    return apiKeys.filter((key) =>
      key.name.toLowerCase().includes(resolvedSearchTerm.toLowerCase())
    )
  }, [apiKeys, resolvedSearchTerm])

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading)
    }
  }, [isLoading, onLoadingChange])

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
    setIsUpdatingKeyName(false)
    setRenameError(null)
  }, [])

  useEffect(() => {
    if (!canRenameKeys) {
      cancelEditingKey()
    }
  }, [canRenameKeys, cancelEditingKey])

  const commitEditingKey = useCallback(async () => {
    if (!editingKeyId || (isWorkspaceScope && !workspaceId) || !canRenameKeys) return
    const trimmedName = editingKeyName.trim()
    if (!trimmedName) {
      setRenameError(t('labels.nameRequired'))
      editKeyNameInputRef.current?.focus()
      return
    }
    setIsUpdatingKeyName(true)
    setRenameError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/api-keys/${editingKeyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const message =
          typeof errorData?.error === 'string'
            ? errorData.error
            : t('labels.failedRename', { scope: scopeLabel })
        setRenameError(message)
        editKeyNameInputRef.current?.focus()
        return
      }
      setApiKeys((prev) =>
        prev.map((key) => (key.id === editingKeyId ? { ...key, name: trimmedName } : key))
      )
      cancelEditingKey()
      void refetchApiKeys()
    } catch (error) {
      logger.error('Error renaming API key', { error, scope })
      setRenameError(t('labels.unableRename', { scope: scopeLabel }))
      editKeyNameInputRef.current?.focus()
    } finally {
      setIsUpdatingKeyName(false)
    }
  }, [
    cancelEditingKey,
    canRenameKeys,
    editingKeyId,
    editingKeyName,
    refetchApiKeys,
    scope,
    scopeLabel,
    t,
    workspaceId,
    isWorkspaceScope,
  ])

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || isSubmittingCreate) return
    if (!workspaceId) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = apiKeys.some((key) => key.name === trimmedName)
    if (isDuplicate) {
      setCreateError(t('labels.duplicateName', { scope: scopeLabel, name: trimmedName }))
      return
    }

    setCreateError(null)
    try {
      const data = await createApiKeyMutation.mutateAsync({
        workspaceId,
        name: trimmedName,
        keyType: isWorkspaceScope ? 'workspace' : 'personal',
      })

      setNewKey(data.key)
      setShowNewKeyDialog(true)
      setIsCreateDialogOpen(false)
      setNewKeyName('')
    } catch (error) {
      logger.error('Error creating API key', { error, scope })
      const message =
        error instanceof Error ? error.message : t('labels.failedCreate', { scope: scopeLabel })
      setCreateError(message)
    }
  }

  const handleDeleteKey = async () => {
    if (!deleteKey) return
    if (!workspaceId) return

    try {
      setApiKeys((prev) => prev.filter((key) => key.id !== deleteKey.id))
      setShowDeleteDialog(false)
      await deleteApiKeyMutation.mutateAsync({
        workspaceId,
        keyId: deleteKey.id,
        keyType: isWorkspaceScope ? 'workspace' : 'personal',
      })
    } catch (error) {
      logger.error('Error deleting API key', { error, scope })
      await refetchApiKeys()
    } finally {
      setDeleteKey(null)
      setDeleteConfirmationName('')
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
      .catch((error) => {
        logger.error('Error copying API key', { error, scope })
      })
  }

  const renderCardView = () => {
    if (isLoading) {
      return (
        <div className='space-y-4'>
          <WorkspaceApiKeySkeleton />
          <WorkspaceApiKeySkeleton />
        </div>
      )
    }

    if (apiKeys.length === 0) {
      return (
        <div className='rounded-2xl border bg-card p-10 text-center shadow-sm'>
          <p className='font-medium'>{t(`emptyState.${scope}.title`)}</p>
          <p className='mt-2 text-muted-foreground'>{t(`emptyState.${scope}.description`)}</p>
          {canManageKeys && (
            <Button
              className='mt-4'
              onClick={() => {
                setIsCreateDialogOpen(true)
                setCreateError(null)
              }}
            >
              <Plus className='mr-2 h-4 w-4 stroke-[2px]' />
              {t(`emptyState.${scope}.button`)}
            </Button>
          )}
        </div>
      )
    }

    if (resolvedSearchTerm.trim() && filteredKeys.length === 0) {
      return (
        <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
          {t('searchEmpty', { scope: scopeLabel, query: resolvedSearchTerm })}
        </div>
      )
    }

    return (
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {filteredKeys.map((key) => {
          return (
            <div
              key={key.id}
              className='rounded-md border bg-card/40 p-4 shadow-xs transition hover:bg-card'
            >
              <div className='flex justify-between gap-4'>
                <div className='w-full'>
                  {canRenameKeys && editingKeyId === key.id ? (
                    <div className='py-1.5'>
                      <div className='flex max-w-md items-center gap-2'>
                        <Input
                          ref={(el) => {
                            if (editingKeyId === key.id) {
                              editKeyNameInputRef.current = el
                            }
                          }}
                          value={editingKeyName}
                          onChange={(event) => setEditingKeyName(event.target.value)}
                          onBlur={() => void commitEditingKey()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void commitEditingKey()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelEditingKey()
                            }
                          }}
                          disabled={isUpdatingKeyName}
                          className='h-8 min-w-0 flex-1'
                          autoComplete='off'
                        />
                        <button
                          type='button'
                          className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                          onClick={() => void commitEditingKey()}
                          disabled={isUpdatingKeyName}
                        >
                          <Check className='h-3.5 w-3.5' />
                          <span className='sr-only'>{t('labels.saveName')}</span>
                        </button>
                      </div>
                      {renameError && <p className='text-destructive text-xs'>{renameError}</p>}
                    </div>
                  ) : (
                    <div className='flex items-center justify-center gap-2'>
                      <div className='space-y-1'>
                        <p className='font-medium'>{key.name}</p>
                        <p className='text-muted-foreground text-xs'>
                          {t('labels.lastUsed', { date: formatDate(key.lastUsed) })}
                        </p>
                      </div>
                      {canRenameKeys && (
                        <button
                          type='button'
                          className='inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                          onClick={() => startEditingKey(key)}
                          disabled={isUpdatingKeyName || (isWorkspaceScope && !workspaceId)}
                        >
                          <Pencil className='h-3.5 w-3.5' />
                          <span className='sr-only'>
                            {t('labels.rename', { scope: scopeLabel })}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className='flex w-full justify-center'>
                  <div className='flex flex-col items-center gap-2 md:flex-row md:justify-center md:gap-2'>
                    <div className='max-w-xs'>
                      <ApiKeyDisplay value={key.displayKey || '—'} />
                    </div>
                    <button
                      type='button'
                      disabled={!canDeleteKeys}
                      className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => {
                        setDeleteKey(key)
                        setShowDeleteDialog(true)
                      }}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                      <span className='sr-only'>{t('labels.delete', { scope: scopeLabel })}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
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

      if (resolvedSearchTerm.trim() && filteredKeys.length === 0) {
        return (
          <tr>
            <td colSpan={5} className='px-4 py-12 text-center text-muted-foreground'>
              {t('searchEmpty', { scope: scopeLabel, query: resolvedSearchTerm })}
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
                      disabled={isUpdatingKeyName}
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
                      disabled={isUpdatingKeyName}
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
                      disabled={isUpdatingKeyName}
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
                        disabled={!canRenameKeys || (isWorkspaceScope && !workspaceId)}
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
                      disabled={!canDeleteKeys}
                      className='h-8 w-8 text-destructive'
                      onClick={() => {
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
    if (isWorkspaceScope && !workspaceId) {
      return (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{t('labels.unableToDetermineWorkspace')}</AlertDescription>
        </Alert>
      )
    }

    if (loadError) {
      return (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )
    }

    return isCardVariant ? renderCardView() : renderTableView()
  }

  const content = renderContent()

  const permissionNotice =
    isWorkspaceScope && !canManageKeys ? (
      <div
        className={cn(
          'text-muted-foreground text-xs',
          isCardVariant ? 'border-t px-6 py-3' : 'px-1 pt-3'
        )}
      >
        {t('labels.workspacePermissions')}
      </div>
    ) : null

  return (
    <>
      {isCardVariant ? (
        <section className='rounded-2xl border bg-card shadow-sm'>
          {shouldRenderHeader && (
            <div className='flex flex-col gap-4 border-b px-6 py-5 md:flex-row md:items-center md:justify-between'>
              <div>
                <h2 className='font-semibold text-lg'>{scopeLabel} API Keys</h2>
                <p className='text-muted-foreground text-sm'>{scopeDescription}</p>
              </div>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
                <div className='flex h-9 items-center gap-2 rounded-lg border bg-background pr-2 pl-3 sm:w-60'>
                  <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
                  <Input
                    placeholder={t('searchPlaceholder')}
                    value={resolvedSearchTerm}
                    onChange={(e) => handleSearchTermChange(e.target.value)}
                    className='flex-1 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0'
                  />
                </div>
                <Button
                  onClick={() => {
                    setIsCreateDialogOpen(true)
                    setCreateError(null)
                  }}
                  disabled={!canManageKeys}
                >
                  <Plus className='mr-2 h-4 w-4' />
                  {t(`create.${scope}`)}
                </Button>
              </div>
            </div>
          )}

          <div className='px-6 py-5'>{content}</div>
          {permissionNotice}
        </section>
      ) : (
        <div className='flex h-full min-h-0 flex-1 flex-col'>
          {content}
          {permissionNotice}
        </div>
      )}

      <AlertDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogs.createTitle', { scope: scopeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {isWorkspaceScope ? t('labels.workspaceAccess') : t('labels.personalAccess')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className='space-y-2'>
            <Label>{t('dialogs.createNameLabel')}</Label>
            <Input
              autoFocus
              placeholder={t('dialogs.createNamePlaceholder')}
              value={newKeyName}
              onChange={(e) => {
                setNewKeyName(e.target.value)
                if (createError) setCreateError(null)
              }}
            />
            {createError && <p className='text-red-600 text-sm'>{createError}</p>}
          </div>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='w-full rounded-sm'
              onClick={() => {
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              {t('dialogs.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className='w-full rounded-sm'
              disabled={
                !newKeyName.trim() || isSubmittingCreate || (isWorkspaceScope && !workspaceId)
              }
              onClick={handleCreateKey}
            >
              {t('dialogs.createButton')}
            </AlertDialogAction>
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
        <AlertDialogContent className='rounded-md sm:max-w-md'>
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

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialogs.deleteTitle', { scope: scopeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialogs.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {deleteKey && (
            <div className='py-2'>
              <p className='mb-2 text-sm'>{t('dialogs.deletePrompt', { name: deleteKey.name })}</p>
              <Input
                autoFocus
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder={t('dialogs.deletePlaceholder')}
              />
            </div>
          )}

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='w-full rounded-sm'
              onClick={() => {
                setDeleteKey(null)
                setDeleteConfirmationName('')
              }}
            >
              {t('dialogs.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className='w-full rounded-sm bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={!deleteKey || deleteConfirmationName !== deleteKey.name}
              onClick={handleDeleteKey}
            >
              {t('dialogs.deleteButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export const WorkspaceApiKeysCard = forwardRef(WorkspaceApiKeysCardComponent)
WorkspaceApiKeysCard.displayName = 'WorkspaceApiKeysCard'

function WorkspaceApiKeySkeleton() {
  return (
    <div className='rounded-xl border bg-card/40 p-4'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='space-y-2'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-24' />
        </div>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-9 w-32 rounded-md' />
          <Skeleton className='h-8 w-20 rounded-md' />
        </div>
      </div>
    </div>
  )
}
