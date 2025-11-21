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
import { AlertCircle, Check, Copy, Plus, Search, Trash2 } from 'lucide-react'
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

function ApiKeyDisplay({ apiKey }: { apiKey: ApiKey }) {
  const displayValue = apiKey.displayKey || apiKey.key
  return (
    <div className='flex h-9 items-center rounded-md bg-muted/70 px-3'>
      <code className='truncate font-mono text-xs'>{displayValue}</code>
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
  }: WorkspaceApiKeysCardProps,
  ref: Ref<WorkspaceApiKeysCardHandle>
) => {
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const [workspaceKeys, setWorkspaceKeys] = useState<ApiKey[]>([])
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

  const isCardVariant = variant === 'card'
  const shouldRenderHeader = isCardVariant && !hideHeader
  const resolvedSearchTerm = controlledSearchTerm ?? internalSearchTerm
  const handleSearchTermChange = onSearchTermChange ?? setInternalSearchTerm

  const filteredWorkspaceKeys = useMemo(() => {
    if (!resolvedSearchTerm.trim()) return workspaceKeys
    return workspaceKeys.filter((key) =>
      key.name.toLowerCase().includes(resolvedSearchTerm.toLowerCase())
    )
  }, [workspaceKeys, resolvedSearchTerm])

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading)
    }
  }, [isLoading, onLoadingChange])

  const fetchWorkspaceKeys = useCallback(async () => {
    if (!workspaceId) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const message =
          errorData?.error || 'Unable to fetch workspace API keys. Please try again later.'
        setLoadError(message)
        logger.error('Failed to fetch workspace API keys', { status: response.status, errorData })
        return
      }

      const data = await response.json()
      setWorkspaceKeys(data.keys || [])
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return
      setLoadError('Unable to fetch workspace API keys. Please try again.')
      logger.error('Error fetching workspace API keys', { error })
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void fetchWorkspaceKeys()
    return () => abortRef.current?.abort()
  }, [fetchWorkspaceKeys])

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

  const handleCreateKey = async () => {
    if (!workspaceId || !newKeyName.trim() || isSubmittingCreate) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = workspaceKeys.some((key) => key.name === trimmedName)
    if (isDuplicate) {
      setCreateError(`A workspace API key named "${trimmedName}" already exists.`)
      return
    }

    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const serverMessage = typeof errorData?.error === 'string' ? errorData.error : null

        if (response.status === 409 || serverMessage?.toLowerCase().includes('already exists')) {
          setCreateError(serverMessage || `A workspace API key named "${trimmedName}" already exists.`)
        } else {
          setCreateError(serverMessage || 'Failed to create workspace API key.')
        }

        logger.error('Failed to create workspace API key', {
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
      await fetchWorkspaceKeys()
    } catch (error) {
      logger.error('Error creating workspace API key', { error })
      setCreateError('Unable to create workspace API key. Please try again.')
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const handleDeleteKey = async () => {
    if (!workspaceId || !deleteKey) return

    try {
      setWorkspaceKeys((prev) => prev.filter((key) => key.id !== deleteKey.id))
      setShowDeleteDialog(false)
      const response = await fetch(`/api/workspaces/${workspaceId}/api-keys/${deleteKey.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to delete workspace API key', { status: response.status, errorData })
        await fetchWorkspaceKeys()
      }
    } catch (error) {
      logger.error('Error deleting workspace API key', { error })
      await fetchWorkspaceKeys()
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

  const renderContent = () => {
    if (!workspaceId) {
      return (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            Unable to determine workspace. Please refresh the page and try again.
          </AlertDescription>
        </Alert>
      )
    }

    if (isLoading) {
      return (
        <div className='space-y-4'>
          <WorkspaceApiKeySkeleton />
          <WorkspaceApiKeySkeleton />
        </div>
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

    if (workspaceKeys.length === 0) {
      return (
        <div className='rounded-2xl border bg-card p-10 text-center shadow-sm'>
          <p className='font-medium'>No workspace API keys yet</p>
          <p className='mt-2 text-muted-foreground'>
            Create one to integrate MCP servers or other workspace tools.
          </p>
          {canManageWorkspaceKeys && (
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

    if (resolvedSearchTerm.trim() && filteredWorkspaceKeys.length === 0) {
      return (
        <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
          No workspace API keys found matching "{resolvedSearchTerm}".
        </div>
      )
    }

    return (
      <div className='space-y-4'>
        {filteredWorkspaceKeys.map((key) => (
          <div
            key={key.id}
            className='rounded-xl border bg-card/40 p-4 shadow-xs transition hover:bg-card'
          >
            <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
              <div className='space-y-1'>
                <p className='font-medium'>{key.name}</p>
                <p className='text-muted-foreground text-xs'>
                  Last used: {formatDate(key.lastUsed)}
                </p>
              </div>
              <div className='flex items-center gap-3'>
                <ApiKeyDisplay apiKey={key} />
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={!canManageWorkspaceKeys}
                  className='text-muted-foreground hover:text-foreground'
                  onClick={() => {
                    setDeleteKey(key)
                    setShowDeleteDialog(true)
                  }}
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const content = renderContent()

  const permissionNotice = !canManageWorkspaceKeys && isCardVariant ? (
    <div className='border-t px-6 py-3 text-muted-foreground text-xs'>
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
                <h2 className='font-semibold text-lg'>Workspace API Keys</h2>
                <p className='text-muted-foreground text-sm'>
                  Generate and manage workspace-scoped API keys for MCP servers or other integrations.
                </p>
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
                  disabled={!canManageWorkspaceKeys}
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
        <>
          {content}
          {permissionNotice}
        </>
      )}

      <AlertDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Create workspace API key</AlertDialogTitle>
            <AlertDialogDescription>
              This key grants access to all workflows and files within this workspace. Copy it
              immediately after creation as you will not be able to see it again.
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
              disabled={!newKeyName.trim() || isSubmittingCreate || !workspaceId}
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
            <AlertDialogTitle>Your workspace API key</AlertDialogTitle>
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
            <AlertDialogTitle>Delete workspace API key?</AlertDialogTitle>
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
