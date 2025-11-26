'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
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
import { Alert, AlertDescription, Button, Input, Label, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { cn } from '@/lib/utils'

interface ApiKey {
  id: string
  name: string
  key: string
  displayKey?: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
  createdBy?: string
}

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

const getMaskedKeyValue = (apiKey: ApiKey): string => {
  const sourceKey = apiKey.key || apiKey.displayKey || ''
  if (!sourceKey) return ''

  const prefixLength = Math.min(4, sourceKey.length)
  const suffixLength = Math.min(4, sourceKey.length - prefixLength)
  const prefix = sourceKey.slice(0, prefixLength)
  const suffix = sourceKey.slice(sourceKey.length - suffixLength)

  const totalLength = apiKey.key?.length ?? sourceKey.length
  const maskedSegmentLength = Math.max(totalLength - (prefixLength + suffixLength), 3)

  if (maskedSegmentLength <= 0) {
    return `${prefix}${suffix}`
  }

  return `${prefix}${'.'.repeat(maskedSegmentLength)}${suffix}`
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
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const scope = keyScope
  const isWorkspaceScope = scope === 'workspace'
  const scopeLabel = isWorkspaceScope ? 'Workspace' : 'Personal'
  const scopeLabelLower = scopeLabel.toLowerCase()
  const scopeDescription = isWorkspaceScope
    ? 'Generate and manage workspace-scoped API keys for MCP servers or other integrations.'
    : 'Generate and manage personal API keys for MCP servers or other integrations.'
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [internalSearchTerm, setInternalSearchTerm] = useState('')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({})
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyName, setEditingKeyName] = useState('')
  const [isUpdatingKeyName, setIsUpdatingKeyName] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const editKeyNameInputRef = useRef<HTMLInputElement | null>(null)

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

  const fetchApiKeys = useCallback(async () => {
    if (isWorkspaceScope && !workspaceId) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)

    try {
      const endpoint = isWorkspaceScope
        ? `/api/workspaces/${workspaceId}/api-keys`
        : '/api/users/me/api-keys'

      const response = await fetch(endpoint, {
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const message =
          errorData?.error || 'Unable to fetch API keys. Please try again later.'
        setLoadError(message)
        logger.error('Failed to fetch API keys', {
          scope,
          status: response.status,
          errorData,
        })
        return
      }

      const data = await response.json()
      setApiKeys(data.keys || [])
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return
      setLoadError('Unable to fetch API keys. Please try again.')
      logger.error('Error fetching API keys', { error, scope })
    } finally {
      setIsLoading(false)
    }
  }, [isWorkspaceScope, workspaceId, scope])

  useEffect(() => {
    void fetchApiKeys()
    return () => abortRef.current?.abort()
  }, [fetchApiKeys])

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
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleCopyKey = useCallback(
    (keyValue: string, keyId: string) => {
      if (!keyValue || typeof navigator === 'undefined' || !navigator.clipboard) {
        return
      }

      void navigator.clipboard
        .writeText(keyValue)
        .then(() => {
          setCopiedKeyId(keyId)
          if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current)
          }
          copyTimeoutRef.current = setTimeout(() => setCopiedKeyId(null), 1500)
        })
        .catch((error) => {
          logger.error('Error copying API key', { error, scope })
        })
    },
    []
  )

  const toggleRevealKey = useCallback((keyId: string) => {
    setRevealedKeys((prev) => ({
      ...prev,
      [keyId]: !prev[keyId],
    }))
  }, [])

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
      setRenameError('Name is required')
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
            : `Failed to rename ${scopeLabelLower} API key.`
        setRenameError(message)
        editKeyNameInputRef.current?.focus()
        return
      }
      setApiKeys((prev) =>
        prev.map((key) => (key.id === editingKeyId ? { ...key, name: trimmedName } : key))
      )
      cancelEditingKey()
    } catch (error) {
      logger.error('Error renaming API key', { error, scope })
      setRenameError(`Unable to rename ${scopeLabelLower} API key. Please try again.`)
      editKeyNameInputRef.current?.focus()
    } finally {
      setIsUpdatingKeyName(false)
    }
  }, [editingKeyId, editingKeyName, workspaceId, cancelEditingKey, canRenameKeys, isWorkspaceScope, scopeLabelLower, scope])

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || isSubmittingCreate) return
    if (isWorkspaceScope && !workspaceId) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = apiKeys.some((key) => key.name === trimmedName)
    if (isDuplicate) {
      setCreateError(`A ${scopeLabelLower} API key named "${trimmedName}" already exists.`)
      return
    }

    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      const endpoint = isWorkspaceScope
        ? `/api/workspaces/${workspaceId}/api-keys`
        : '/api/users/me/api-keys'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const serverMessage = typeof errorData?.error === 'string' ? errorData.error : null

        if (response.status === 409 || serverMessage?.toLowerCase().includes('already exists')) {
          setCreateError(
            serverMessage || `A ${scopeLabelLower} API key named "${trimmedName}" already exists.`
          )
        } else {
          setCreateError(
            serverMessage || `Failed to create ${scopeLabelLower} API key. Please try again.`
          )
        }

        logger.error('Failed to create API key', {
          scope,
          status: response.status,
          errorData,
        })
        return
      }

      const data = await response.json()
      setNewKey(data.key)
      setShowNewKeyDialog(true)
      setIsCreateDialogOpen(false)
      setNewKeyName('')
      await fetchApiKeys()
    } catch (error) {
      logger.error('Error creating API key', { error, scope })
      setCreateError(`Unable to create ${scopeLabelLower} API key. Please try again.`)
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const handleDeleteKey = async () => {
    if (!deleteKey) return
    if (isWorkspaceScope && !workspaceId) return

    try {
      setApiKeys((prev) => prev.filter((key) => key.id !== deleteKey.id))
      setShowDeleteDialog(false)
      const endpoint = isWorkspaceScope
        ? `/api/workspaces/${workspaceId}/api-keys/${deleteKey.id}`
        : `/api/users/me/api-keys/${deleteKey.id}`
      const response = await fetch(endpoint, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to delete API key', { scope, status: response.status, errorData })
        await fetchApiKeys()
      }
    } catch (error) {
      logger.error('Error deleting API key', { error, scope })
      await fetchApiKeys()
    } finally {
      setDeleteKey(null)
      setDeleteConfirmationName('')
    }
  }

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 1500)
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
          <p className='font-medium'>No {scopeLabelLower} API keys yet</p>
          <p className='mt-2 text-muted-foreground'>Create one to start integrating right away.</p>
          {canManageKeys && (
            <Button
              className='mt-4'
              onClick={() => {
                setIsCreateDialogOpen(true)
                setCreateError(null)
              }}
            >
              <Plus className='mr-2 h-4 w-4 stroke-[2px]' />
              Create Key
            </Button>
          )}
        </div>
      )
    }

    if (resolvedSearchTerm.trim() && filteredKeys.length === 0) {
      return (
        <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
          No {scopeLabelLower} API keys found matching "{resolvedSearchTerm}".
        </div>
      )
    }

    return (
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {filteredKeys.map((key) => {
          const rawKeyValue = key.key || key.displayKey || ''
          const isRevealed = Boolean(revealedKeys[key.id])
          const displayValue = rawKeyValue
            ? isRevealed
              ? rawKeyValue
              : getMaskedKeyValue(key)
            : key.displayKey || '—'
          const canRevealOrCopy = Boolean(rawKeyValue)
          const isCopied = copiedKeyId === key.id

          return (
            <div
              key={key.id}
              className='rounded-md border bg-card/40 p-4 shadow-xs transition hover:bg-card'
            >
              <div className='flex justify-between gap-4'>
                <div className='w-full'>
                  {canRenameKeys && editingKeyId === key.id ? (
                    <div className='py-1.5'>
                      <div className='flex items-center gap-2 max-w-md'>
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
                          className='h-8 flex-1 min-w-0'
                          autoComplete='off'
                        />
                        <button
                          type='button'
                          className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                          onClick={() => void commitEditingKey()}
                          disabled={isUpdatingKeyName}
                        >
                          <Check className='h-3.5 w-3.5' />
                          <span className='sr-only'>Save API key name</span>
                        </button>
                      </div>
                      {renameError && (
                        <p className='text-destructive text-xs'>{renameError}</p>
                      )}
                    </div>
                  ) : (
                    <div className='flex items-center justify-center gap-2'>
                      <div className='space-y-1'>
                        <p className='font-medium'>{key.name}</p>
                        <p className='text-muted-foreground text-xs'>
                          Last used: {formatDate(key.lastUsed)}
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
                          <span className='sr-only'>Rename {scopeLabelLower} API key</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className='flex w-full justify-center'>
                  <div className='flex flex-col items-center gap-2 md:flex-row md:justify-center md:gap-2'>
                    <button
                      type='button'
                      disabled={!canRevealOrCopy}
                      className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => toggleRevealKey(key.id)}
                    >
                      {isRevealed ? (
                        <EyeOff className='h-3.5 w-3.5' />
                      ) : (
                        <Eye className='h-3.5 w-3.5' />
                      )}
                      <span className='sr-only'>
                        {isRevealed
                          ? `Hide ${scopeLabelLower} API key`
                          : `Reveal ${scopeLabelLower} API key`}
                      </span>
                    </button>
                    <div className='max-w-xs'>
                      <ApiKeyDisplay value={displayValue} />
                    </div>
                    <button
                      type='button'
                      disabled={!canRevealOrCopy}
                      className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => handleCopyKey(rawKeyValue, key.id)}
                    >
                      {isCopied ? (
                        <Check className='h-3.5 w-3.5' />
                      ) : (
                        <Copy className='h-3.5 w-3.5' />
                      )}
                      <span className='sr-only'>Copy {scopeLabelLower} API key</span>
                    </button>
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
                      <span className='sr-only'>Delete {scopeLabelLower} API key</span>
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
              <p className='font-medium text-lg'>No {scopeLabelLower} API keys yet</p>
              <p className='mt-2 text-muted-foreground'>Create one to start integrating.</p>
              {canManageKeys && (
                <Button
                  className='mt-6'
                  onClick={() => {
                    setIsCreateDialogOpen(true)
                    setCreateError(null)
                  }}
                >
                  <Plus className='mr-2 h-4 w-4' />
                  Create Key
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
              No {scopeLabelLower} API keys found matching "{resolvedSearchTerm}".
            </td>
          </tr>
        )
      }

      return filteredKeys.map((key) => {
        const rawKeyValue = key.key || key.displayKey || ''
        const isRevealed = Boolean(revealedKeys[key.id])
        const displayValue = rawKeyValue
          ? isRevealed
            ? rawKeyValue
            : getMaskedKeyValue(key)
          : key.displayKey || '—'
        const canRevealOrCopy = Boolean(rawKeyValue)
        const isCopied = copiedKeyId === key.id
        const isEditing = canRenameKeys && editingKeyId === key.id

        return (
          <tr key={key.id} className='border-b transition-colors hover:bg-card/30'>
            <td className='px-4 py-4 text-muted-foreground text-sm text-center'>
              {formatDate(key.createdAt)}
            </td>
            <td className='px-4 py-4 align-center'>
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
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  disabled={!canRevealOrCopy}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => toggleRevealKey(key.id)}
                >
                  {isRevealed ? (
                    <EyeOff className='h-4 w-4' />
                  ) : (
                    <Eye className='h-4 w-4' />
                  )}
                  <span className='sr-only'>
                    {isRevealed
                      ? `Hide ${scopeLabelLower} API key`
                      : `Reveal ${scopeLabelLower} API key`}
                  </span>
                </Button>
                <div className='min-w-0 flex-1'>
                  <ApiKeyDisplay value={displayValue} />
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  disabled={!canRevealOrCopy}
                  className='h-8 w-8 text-muted-foreground'
                  onClick={() => handleCopyKey(rawKeyValue, key.id)}
                >
                  {isCopied ? (
                    <Check className='h-4 w-4' />
                  ) : (
                    <Copy className='h-4 w-4' />
                  )}
                  <span className='sr-only'>Copy {scopeLabelLower} API key</span>
                </Button>
              </div>
            </td>
            <td className='px-4 py-4 text-muted-foreground text-sm text-center'>
              {formatDate(key.lastUsed)}
            </td>
            <td className='px-4 py-4'>
              <div className='flex items-center justify-end gap-1.5'>
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
                      <span className='sr-only'>Save {scopeLabelLower} API key</span>
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
                      <span className='sr-only'>Cancel rename</span>
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
                        <span className='sr-only'>Rename {scopeLabelLower} API key</span>
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
                      <span className='sr-only'>Delete {scopeLabelLower} API key</span>
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
                    Created At
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Name
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Key
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Last Update
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Actions
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
          <AlertDescription>
            Unable to determine workspace. Please refresh the page and try again.
          </AlertDescription>
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
        You need edit or admin access to manage workspace API keys.
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
                    placeholder='Search keys...'
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
                  Create Key
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
            <AlertDialogTitle>Create {scopeLabelLower} API key</AlertDialogTitle>
            <AlertDialogDescription>
              {isWorkspaceScope
                ? 'This key grants access to all workflows and files within this workspace. Copy it immediately after creation as you will not be able to see it again.'
                : 'This key grants access to your personal workflows and files. Copy it immediately after creation as you will not be able to see it again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className='space-y-2'>
            <Label>Name</Label>
            <Input
              autoFocus
              placeholder='e.g., Production MCP Server'
              value={newKeyName}
              onChange={(e) => {
                setNewKeyName(e.target.value)
                if (createError) setCreateError(null)
              }}
            />
            {createError && <p className='text-sm text-red-600'>{createError}</p>}
          </div>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='w-full rounded-sm'
              onClick={() => {
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className='w-full rounded-sm'
              disabled={
                !newKeyName.trim() || isSubmittingCreate || (isWorkspaceScope && !workspaceId)
              }
              onClick={handleCreateKey}
            >
              Create Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setCopySuccess(false)
          }
        }}
      >
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Your {scopeLabelLower} API key</AlertDialogTitle>
            <AlertDialogDescription>
              This is the only time you will see the full key. Copy and store it securely.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {newKey && (
            <div className='relative'>
              <div className='flex h-10 items-center rounded-md bg-muted px-3 pr-10'>
                <code className='flex-1 truncate font-mono text-sm'>{newKey.key}</code>
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 rounded-sm text-muted-foreground hover:bg-card hover:text-foreground'
                onClick={() => copyToClipboard(newKey.key)}
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
            <AlertDialogTitle>Delete {scopeLabelLower} API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke access for any integrations using this key.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteKey && (
            <div className='py-2'>
              <p className='mb-2 text-sm'>
                Type <span className='font-semibold'>{deleteKey.name}</span> to confirm.
              </p>
              <Input
                autoFocus
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder='API key name'
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
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className='w-full rounded-sm bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={!deleteKey || deleteConfirmationName !== deleteKey.name}
              onClick={handleDeleteKey}
            >
              Delete Key
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
