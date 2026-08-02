'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useMessages } from 'next-intl'
import { GmailIcon, OutlookIcon } from '@/components/icons/icons'
import { OAuthRequiredModal } from '@/components/oauth/oauth-required-modal'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import { type Credential, getProviderIdFromServiceId, getServiceIdFromScopes } from '@/lib/oauth'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('FolderSelector')

export interface FolderInfo {
  id: string
  name: string
  type: string
  messagesTotal?: number
  messagesUnread?: number
}

type FolderLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'failure' | 'reconnect-required'

async function readFolderResponse(response: Response) {
  if (response.ok) return response.json()
  const failure = (await response.json().catch(() => null)) as { authRequired?: boolean } | null
  throw new Error('Folder request failed', { cause: failure?.authRequired === true })
}

interface FolderSelectorProps {
  value: string
  onChange: (value: string, folderInfo?: FolderInfo) => void
  provider: string
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  onFolderInfoChange?: (folderInfo: FolderInfo | null) => void
  credentialId?: string
  workflowId?: string
  workspaceId?: string
  isForeignCredential?: boolean
}

export function FolderSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label,
  disabled = false,
  serviceId,
  onFolderInfoChange,
  credentialId,
  workflowId,
  workspaceId,
  isForeignCredential = false,
}: FolderSelectorProps) {
  const copy = useMessages().workspace.widgets.workflowLabels
  const [open, setOpen] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const feedbackId = useId()
  const labelText = label ?? copy.selectFolder
  const effectiveServiceId = serviceId || getServiceIdFromScopes(provider, requiredScopes)
  const providerId = getProviderIdFromServiceId(effectiveServiceId)
  const requestScope = workflowId ? `workflow:${workflowId}` : `workspace:${workspaceId ?? ''}`
  const credentialsContext = JSON.stringify([providerId, requestScope])
  const [localCredential, setLocalCredential] = useState({ context: credentialsContext, id: '' })
  const suppliedCredentialId = credentialId?.trim() || ''
  const selectedCredentialId =
    suppliedCredentialId ||
    (localCredential.context === credentialsContext ? localCredential.id : '')
  const listContext = JSON.stringify([
    provider,
    selectedCredentialId,
    requestScope,
    isForeignCredential,
  ])
  const metaContext = JSON.stringify([listContext, value])
  const [credentialRequest, setCredentialRequest] = useState({
    context: credentialsContext,
    credentials: [] as Credential[],
    status: 'idle' as FolderLoadState,
  })
  const [folderRequest, setFolderRequest] = useState({
    context: listContext,
    folders: [] as FolderInfo[],
    query: '',
    status: 'idle' as FolderLoadState,
  })
  const [meta, setMeta] = useState({ context: metaContext, folder: null as FolderInfo | null })
  const requests = useRef({ credentials: 0, list: 0, metadata: 0 })
  const latest = useLatestRef({
    credentials: credentialsContext,
    list: listContext,
    metadata: metaContext,
    onFolderInfoChange,
  })
  const loadState = selectedCredentialId
    ? folderRequest.context === listContext
      ? folderRequest.status
      : 'idle'
    : credentialRequest.context === credentialsContext
      ? credentialRequest.status
      : 'idle'
  const visibleCredentials =
    credentialRequest.context === credentialsContext ? credentialRequest.credentials : []
  const visibleFolders = folderRequest.context === listContext ? folderRequest.folders : []
  const visibleSelectedFolder = meta.context === metaContext ? meta.folder : null

  useEffect(
    () => () => {
      for (const key of ['credentials', 'list', 'metadata'] as const) requests.current[key] += 1
    },
    []
  )
  useEffect(() => {
    if (selectedCredentialId) return
    const defaultCredential =
      visibleCredentials.find((candidate) => candidate.isDefault) ??
      (visibleCredentials.length === 1 ? visibleCredentials[0] : undefined)
    if (defaultCredential)
      setLocalCredential({ context: credentialsContext, id: defaultCredential.id })
  }, [credentialsContext, selectedCredentialId, visibleCredentials])

  const fetchCredentials = useCallback(async () => {
    const requestGeneration = ++requests.current.credentials
    const requestContext = latest.current.credentials
    const ownsRequest = () =>
      requestGeneration === requests.current.credentials &&
      requestContext === latest.current.credentials
    setCredentialRequest({ context: requestContext, credentials: [], status: 'loading' })
    try {
      const query = new URLSearchParams({ provider: providerId })
      if (workflowId) query.set('workflowId', workflowId)
      else if (workspaceId) query.set('workspaceId', workspaceId)
      const response = await fetch(`/api/auth/oauth/credentials?${query.toString()}`)
      if (!ownsRequest()) return

      if (!response.ok) throw new Error('Credential request failed')
      const data = await response.json()
      if (!ownsRequest()) return
      const nextCredentials = Array.isArray(data.credentials) ? data.credentials : []
      setCredentialRequest({
        context: requestContext,
        credentials: nextCredentials,
        status: nextCredentials.length > 0 ? 'ready' : 'empty',
      })
    } catch (error) {
      if (!ownsRequest()) return
      logger.error('Error fetching credentials:', { error })
      setCredentialRequest({ context: requestContext, credentials: [], status: 'failure' })
    }
  }, [providerId, workflowId, workspaceId])

  const fetchFolders = useCallback(
    async (searchQuery = '') => {
      if (!selectedCredentialId) return

      const requestGeneration = ++requests.current.list
      const requestContext = listContext
      const ownsRequest = () =>
        requestGeneration === requests.current.list && requestContext === latest.current.list
      setFolderRequest({
        context: requestContext,
        folders: [],
        query: searchQuery,
        status: 'loading',
      })
      try {
        const queryParams = new URLSearchParams({ credentialId: selectedCredentialId })
        if (workflowId) queryParams.set('workflowId', workflowId)
        else if (workspaceId) queryParams.set('workspaceId', workspaceId)
        if (searchQuery) queryParams.set('query', searchQuery)

        let folderList: FolderInfo[] = []
        if (!(provider === 'outlook' && isForeignCredential)) {
          const endpoint =
            provider === 'outlook'
              ? `/api/tools/outlook/folders?${queryParams.toString()}`
              : `/api/tools/gmail/labels?${queryParams.toString()}`
          const data = await readFolderResponse(await fetch(endpoint))
          if (!ownsRequest()) return
          folderList = (provider === 'outlook' ? data.folders : data.labels) || []
        }
        if (!ownsRequest()) return
        setFolderRequest({
          context: requestContext,
          folders: folderList,
          query: searchQuery,
          status: folderList.length > 0 ? 'ready' : 'empty',
        })
      } catch (error) {
        if (!ownsRequest()) return
        logger.error('Error fetching folders:', { error })
        const status =
          error instanceof Error && error.cause === true ? 'reconnect-required' : 'failure'
        setFolderRequest({ context: requestContext, folders: [], query: searchQuery, status })
      }
    },
    [provider, isForeignCredential, workflowId, workspaceId, selectedCredentialId, listContext]
  )

  const fetchSelectedFolder = useCallback(async () => {
    const requestGeneration = ++requests.current.metadata
    const requestContext = metaContext
    const ownsRequest = () =>
      requestGeneration === requests.current.metadata && requestContext === latest.current.metadata
    setMeta({ context: requestContext, folder: null })
    latest.current.onFolderInfoChange?.(null)
    if (disabled || !selectedCredentialId || !value) return

    try {
      const query = new URLSearchParams({ credentialId: selectedCredentialId })
      if (workflowId) query.set('workflowId', workflowId)
      else if (workspaceId) query.set('workspaceId', workspaceId)
      query.set(provider === 'outlook' ? 'folderId' : 'labelId', value)
      const endpoint =
        provider === 'outlook'
          ? `/api/tools/outlook/folders?${query.toString()}`
          : `/api/tools/gmail/label?${query.toString()}`
      const data = await readFolderResponse(await fetch(endpoint))
      if (!ownsRequest()) return
      const folderInfo = provider === 'outlook' ? data.folder : data.label
      if (!folderInfo) return
      setMeta({ context: requestContext, folder: folderInfo })
      latest.current.onFolderInfoChange?.(folderInfo)
    } catch (error) {
      if (ownsRequest()) logger.error('Error fetching selected folder:', { error })
    }
  }, [disabled, metaContext, provider, selectedCredentialId, value, workflowId, workspaceId])

  useEffect(() => {
    if (disabled) {
      requests.current.credentials += 1
      setCredentialRequest({ context: credentialsContext, credentials: [], status: 'idle' })
      return
    }
    void fetchCredentials()
  }, [disabled, fetchCredentials])

  useEffect(() => {
    if (disabled || !selectedCredentialId) {
      requests.current.list += 1
      setFolderRequest({ context: listContext, folders: [], query: '', status: 'idle' })
      return
    }
    void fetchFolders()
  }, [disabled, selectedCredentialId, listContext, fetchFolders])

  useEffect(() => {
    void fetchSelectedFolder()
  }, [fetchSelectedFolder])

  const handleSelectFolder = (folder: FolderInfo) => {
    requests.current.metadata += 1
    onChange(folder.id, folder)
    setOpen(false)
  }

  const handleSelectCredential = (nextCredentialId: string) => {
    if (suppliedCredentialId || nextCredentialId === selectedCredentialId) return
    requests.current.list += 1
    requests.current.metadata += 1
    latest.current.onFolderInfoChange?.(null)
    setLocalCredential({ context: credentialsContext, id: nextCredentialId })
  }

  const handleAddCredential = () => {
    setShowOAuthModal(true)
    setOpen(false)
  }

  const handleSearch = (query: string) => {
    if (query.length > 2 || query.length === 0) {
      void fetchFolders(query)
      return
    }
    requests.current.list += 1
    setFolderRequest({ context: listContext, folders: [], query, status: 'idle' })
  }

  const providerName = provider === 'outlook' ? 'Outlook' : 'Gmail'
  const folderLabel = provider === 'outlook' ? copy.folders : copy.labels
  const FolderIcon = provider === 'gmail' ? GmailIcon : provider === 'outlook' ? OutlookIcon : null
  const itemName = folderLabel.toLowerCase()
  const emptyTitle = selectedCredentialId
    ? formatTemplate(copy.noItemsFound, { itemName })
    : copy.noAccountsConnected
  const feedback =
    loadState === 'loading'
      ? formatTemplate(copy.loadingItems, { itemName })
      : loadState === 'empty'
        ? emptyTitle
        : loadState === 'failure'
          ? formatTemplate(copy.failedToLoadItems, { itemName })
          : loadState === 'reconnect-required'
            ? formatTemplate(copy.reconnectProviderAccount, {
                providerName,
                itemName,
              })
            : null
  const feedbackIsError = loadState === 'failure' || loadState === 'reconnect-required'
  const emptyDetail = selectedCredentialId
    ? copy.tryDifferentSearchOrAccount
    : formatTemplate(copy.connectProviderAccountToContinue, { providerName })
  const searchPlaceholder = formatTemplate(copy.searchItems, { itemName })

  return (
    <>
      <div className='space-y-2'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={disabled || isForeignCredential}
            render={
              <Button
                variant='outline'
                role='combobox'
                aria-expanded={open}
                aria-describedby={feedback ? feedbackId : undefined}
                className='w-full justify-between'
                disabled={disabled || isForeignCredential}
              />
            }
          >
            {visibleSelectedFolder ? (
              <div className='flex items-center gap-1 overflow-hidden'>
                {FolderIcon && <FolderIcon className='h-4 w-4' />}
                <span className='truncate font-normal'>{visibleSelectedFolder.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1'>
                {FolderIcon && <FolderIcon className='h-4 w-4' />}
                <span className='text-muted-foreground'>{labelText}</span>
              </div>
            )}
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </PopoverTrigger>
          {!isForeignCredential && (
            <PopoverContent className='w-[300px] p-0' align='start'>
              {selectedCredentialId && visibleCredentials.length > 0 && (
                <div className='border-b px-3 py-2 text-muted-foreground text-xs'>
                  {visibleCredentials.find((cred) => cred.id === selectedCredentialId)?.name ||
                    copy.unknown}
                </div>
              )}

              <Command>
                <CommandInput placeholder={searchPlaceholder} onValueChange={handleSearch} />
                <CommandList>
                  <CommandEmpty>
                    {loadState === 'loading' ? (
                      <div className='flex items-center justify-center p-4'>
                        <RefreshCw className='h-4 w-4 animate-spin' />
                        <span className='ml-2'>{feedback}</span>
                      </div>
                    ) : (
                      <div className='p-4 text-center'>
                        <p className='font-medium text-sm'>{emptyTitle}</p>
                        <p className='text-muted-foreground text-xs'>{emptyDetail}</p>
                      </div>
                    )}
                  </CommandEmpty>

                  {!suppliedCredentialId && visibleCredentials.length > 1 && (
                    <CommandGroup heading={copy.switchAccount}>
                      {visibleCredentials.map((cred) => (
                        <CommandItem
                          key={cred.id}
                          value={`account-${cred.id}`}
                          onSelect={() => handleSelectCredential(cred.id)}
                        >
                          {cred.name}
                          {cred.id === selectedCredentialId && (
                            <Check className='ml-auto h-4 w-4' />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {visibleFolders.length > 0 && (
                    <CommandGroup heading={folderLabel}>
                      {visibleFolders.map((folder) => (
                        <CommandItem
                          key={folder.id}
                          value={`folder-${folder.id}-${folder.name}`}
                          onSelect={() => handleSelectFolder(folder)}
                          className='w-full overflow-hidden'
                        >
                          {FolderIcon && <FolderIcon className='h-4 w-4' />}
                          <span className='truncate font-normal'>{folder.name}</span>
                          {folder.id === value && <Check className='ml-auto h-4 w-4' />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {!selectedCredentialId && visibleCredentials.length === 0 && (
                    <CommandGroup>
                      <CommandItem onSelect={handleAddCredential}>
                        {formatTemplate(copy.connectProviderAccount, { providerName })}
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          )}
        </Popover>
        {feedback && (
          <div
            id={feedbackId}
            role={feedbackIsError ? 'alert' : 'status'}
            aria-atomic='true'
            className='flex items-center justify-between gap-2 text-muted-foreground text-xs'
          >
            <span className={feedbackIsError ? 'text-destructive' : undefined}>{feedback}</span>
            {loadState === 'failure' && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-7 shrink-0 px-2 text-xs'
                onClick={() => {
                  if (selectedCredentialId) void fetchFolders(folderRequest.query)
                  else void fetchCredentials()
                }}
              >
                {copy.tryAgain}
              </Button>
            )}
            {(loadState === 'reconnect-required' ||
              (loadState === 'empty' && !selectedCredentialId)) && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-7 shrink-0 px-2 text-xs'
                onClick={handleAddCredential}
              >
                {formatTemplate(copy.connectProviderAccount, {
                  providerName,
                })}
              </Button>
            )}
          </div>
        )}
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={providerName}
          requiredScopes={requiredScopes}
          serviceId={effectiveServiceId}
        />
      )}
    </>
  )
}
