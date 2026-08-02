'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useMessages } from 'next-intl'
import { ConfluenceIcon } from '@/components/icons/icons'
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
import type { OAuthProvider } from '@/lib/oauth'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('ConfluenceFileSelector')

export interface ConfluenceFileInfo {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  modifiedTime?: string
}

interface ConfluenceFileSelectorProps {
  value: string
  onChange: (value: string, fileInfo?: ConfluenceFileInfo) => void
  provider: OAuthProvider
  label?: string
  disabled?: boolean
  domain: string
  showPreview?: boolean
  credentialId: string
  workflowId?: string
  workspaceId?: string
  isForeignCredential?: boolean
}

export function ConfluenceFileSelector({
  value,
  onChange,
  provider,
  label,
  disabled = false,
  domain,
  showPreview = true,
  credentialId,
  workflowId,
  workspaceId,
  isForeignCredential = false,
}: ConfluenceFileSelectorProps) {
  const copy = useMessages().workspace.widgets.workflowLabels
  const selectorCopy = useMessages().workspace.widgets.blockEditor.confluenceFileSelector
  const feedbackId = useId()
  const metadataContext = JSON.stringify([
    credentialId,
    domain,
    value,
    provider,
    workflowId,
    workspaceId,
  ])
  const listContext = JSON.stringify([credentialId, domain, provider, workflowId, workspaceId])
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<ConfluenceFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState<{
    context: string
    info: ConfluenceFileInfo | null
  } | null>(null)
  const activeFile =
    selectedFile?.context === metadataContext && selectedFile.info?.id === value
      ? selectedFile.info
      : null
  const [pendingRequests, setPendingRequests] = useState(0)
  const mountedRef = useRef(false)
  const filesRequestRef = useRef(0)
  const selectionRequestRef = useRef(0)
  const feedbackRequestRef = useRef(0)
  const searchIntentRef = useRef(0)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const selectorContextRef = useRef({
    list: listContext,
    metadata: metadataContext,
  })
  selectorContextRef.current = {
    list: listContext,
    metadata: metadataContext,
  }
  const [errorKey, setErrorKey] = useState<keyof typeof selectorCopy.errors | null>(null)
  const labelText = label ?? copy.selectConfluencePage
  const errorMessage = errorKey ? selectorCopy.errors[errorKey] : null
  const isLoading = pendingRequests > 0
  const announcedError = isLoading ? null : errorMessage

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      filesRequestRef.current += 1
      selectionRequestRef.current += 1
      feedbackRequestRef.current += 1
      searchIntentRef.current += 1
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (activeFile) return
    filesRequestRef.current += 1
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    searchIntentRef.current += 1
    setErrorKey(null)
    setFiles([])
    setSelectedFile(null)
  }, [credentialId, domain, provider, value, workflowId, workspaceId, activeFile])

  const handleSearch = (value: string) => {
    const searchIntent = ++searchIntentRef.current
    filesRequestRef.current += 1

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (value.length > 0 && value.length <= 2) {
      return
    }

    const requestContext = selectorContextRef.current.list
    searchTimeoutRef.current = setTimeout(() => {
      if (
        searchIntent !== searchIntentRef.current ||
        requestContext !== selectorContextRef.current.list
      ) {
        return
      }

      void fetchFiles(value || undefined, searchIntent)
    }, 500)
  }

  const fetchPageInfo = useCallback(
    async (pageId: string) => {
      if (!credentialId || !domain) return

      const selectionGeneration = ++selectionRequestRef.current
      const feedbackGeneration = ++feedbackRequestRef.current
      const requestMetadataContext = metadataContext

      setPendingRequests((count) => count + 1)
      if (feedbackGeneration === feedbackRequestRef.current) setErrorKey(null)

      try {
        const response = await fetch('/api/tools/confluence/page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            credentialId,
            ...(workflowId ? { workflowId } : workspaceId ? { workspaceId } : {}),
            pageId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Confluence page info API error:', errorData)
          throw new Error('failedToFetchPageInfo')
        }

        const data = await response.json()
        if (
          !mountedRef.current ||
          selectionGeneration !== selectionRequestRef.current ||
          requestMetadataContext !== selectorContextRef.current.metadata
        ) {
          return
        }
        if (data.file) {
          setSelectedFile({ context: requestMetadataContext, info: data.file })
        } else {
          const fileInfo: ConfluenceFileInfo = {
            id: data.id || pageId,
            name: data.title || `Page ${pageId}`,
            mimeType: 'confluence/page',
            webViewLink: undefined,
            modifiedTime: undefined,
          }
          setSelectedFile({ context: requestMetadataContext, info: fileInfo })
        }
      } catch (error) {
        logger.error('Error fetching page info:', error)
        if (
          mountedRef.current &&
          feedbackGeneration === feedbackRequestRef.current &&
          selectionGeneration === selectionRequestRef.current &&
          requestMetadataContext === selectorContextRef.current.metadata
        ) {
          setErrorKey('failedToFetchPageInfo')
          setSelectedFile({ context: requestMetadataContext, info: null })
        }
      } finally {
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1))
        }
      }
    },
    [credentialId, domain, metadataContext, workflowId, workspaceId]
  )

  const fetchFiles = useCallback(
    async (searchQuery?: string, requestIntent?: number) => {
      if (!credentialId || !domain) return
      if (isForeignCredential) return

      const filesIntent = requestIntent ?? ++searchIntentRef.current
      const filesGeneration = ++filesRequestRef.current
      const feedbackGeneration = ++feedbackRequestRef.current
      const selectionGeneration =
        !searchQuery && value ? ++selectionRequestRef.current : selectionRequestRef.current
      const requestListContext = selectorContextRef.current.list
      const requestMetadataContext = metadataContext
      const ownsFileRequest = () =>
        mountedRef.current &&
        filesGeneration === filesRequestRef.current &&
        filesIntent === searchIntentRef.current &&
        requestListContext === selectorContextRef.current.list

      const trimmedDomain = domain.trim().toLowerCase()
      if (!trimmedDomain.includes('.')) {
        if (ownsFileRequest()) {
          setFiles([])
        }
        if (ownsFileRequest() && feedbackGeneration === feedbackRequestRef.current) {
          setErrorKey('invalidDomainFormat')
        }
        return
      }

      setPendingRequests((count) => count + 1)
      if (feedbackGeneration === feedbackRequestRef.current) setErrorKey(null)

      try {
        const response = await fetch('/api/tools/confluence/pages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            credentialId,
            ...(workflowId ? { workflowId } : workspaceId ? { workspaceId } : {}),
            title: searchQuery || undefined,
            limit: 50,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          if (response.status === 401 || response.status === 403) {
            logger.info('Confluence pages fetch unauthorized (expected for collaborator)')
            if (ownsFileRequest()) {
              setFiles([])
            }
            return
          }
          logger.error('Confluence API error:', errorData)
          throw new Error('failedToFetchPages')
        }

        const data = await response.json()
        logger.info(`Received ${data.files?.length || 0} files from API`)
        if (!ownsFileRequest()) return
        setFiles(data.files || [])

        if (!searchQuery && value) {
          const fileInfo = data.files.find((file: ConfluenceFileInfo) => file.id === value)
          const ownsSelection =
            selectionGeneration === selectionRequestRef.current &&
            requestMetadataContext === selectorContextRef.current.metadata
          if (fileInfo && ownsSelection) {
            setSelectedFile({ context: requestMetadataContext, info: fileInfo })
          } else if (!fileInfo && ownsSelection) {
            void fetchPageInfo(value)
          }
        }
      } catch (error) {
        logger.error('Error fetching pages:', error)
        if (ownsFileRequest() && feedbackGeneration === feedbackRequestRef.current) {
          setErrorKey('failedToFetchPages')
        }
        if (ownsFileRequest()) {
          setFiles([])
        }
      } finally {
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1))
        }
      }
    },
    [
      credentialId,
      domain,
      value,
      fetchPageInfo,
      workflowId,
      workspaceId,
      isForeignCredential,
      metadataContext,
    ]
  )

  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))

    if (isOpen && !isForeignCredential && credentialId && domain && domain.includes('.')) {
      fetchFiles()
    }
  }

  useEffect(() => {
    if (value && credentialId && !activeFile && domain && domain.includes('.')) {
      fetchPageInfo(value)
    }
  }, [value, credentialId, activeFile, domain, fetchPageInfo, workflowId, isForeignCredential])

  const handleSelectFile = (file: ConfluenceFileInfo) => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    setErrorKey(null)
    setSelectedFile({
      context: JSON.stringify([credentialId, domain, file.id, provider, workflowId, workspaceId]),
      info: file,
    })
    onChange(file.id, file)
    setOpen(false)
  }

  const handleClearSelection = () => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    setSelectedFile({ context: metadataContext, info: null })
    setErrorKey(null)
    onChange('', undefined)
  }

  return (
    <div className='space-y-2'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={disabled || !domain || !credentialId || isForeignCredential}
          render={
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              aria-busy={isLoading || undefined}
              aria-describedby={isLoading || announcedError ? feedbackId : undefined}
              aria-invalid={announcedError ? true : undefined}
              aria-errormessage={announcedError ? feedbackId : undefined}
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled || !domain || !credentialId || isForeignCredential}
            />
          }
        >
          <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
            {activeFile ? (
              <>
                <ConfluenceIcon className='h-4 w-4' />
                <span className='truncate font-normal'>{activeFile.name}</span>
              </>
            ) : (
              <>
                <ConfluenceIcon className='h-4 w-4' />
                <span className='truncate text-muted-foreground'>{labelText}</span>
              </>
            )}
          </div>
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </PopoverTrigger>
        {!isForeignCredential && (
          <PopoverContent className='w-[300px] p-0' align='start'>
            <Command>
              <CommandInput
                placeholder={formatTemplate(copy.searchItems, {
                  itemName: copy.pages.toLowerCase(),
                })}
                onValueChange={handleSearch}
              />
              <CommandList>
                <CommandEmpty>
                  {!isLoading && !errorMessage ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>
                        {formatTemplate(copy.noItemsFound, {
                          itemName: copy.pages.toLowerCase(),
                        })}
                      </p>
                    </div>
                  ) : null}
                </CommandEmpty>

                {files.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      {copy.pages}
                    </div>
                    {files.map((file) => (
                      <CommandItem
                        key={file.id}
                        value={`file-${file.id}-${file.name}`}
                        onSelect={() => handleSelectFile(file)}
                      >
                        <div className='flex items-center gap-1 overflow-hidden'>
                          <ConfluenceIcon className='h-4 w-4' />
                          <span className='truncate font-normal'>{file.name}</span>
                        </div>
                        {file.id === value && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        )}
      </Popover>
      {isLoading || announcedError ? (
        <p
          id={feedbackId}
          role={isLoading ? 'status' : 'alert'}
          aria-atomic='true'
          className={announcedError ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
        >
          {isLoading
            ? formatTemplate(copy.loadingItems, {
                itemName: copy.pages.toLowerCase(),
              })
            : announcedError}
        </p>
      ) : null}

      {showPreview && activeFile && (
        <div className='relative mt-2 rounded-md border border-muted bg-muted/10 p-2'>
          <div className='absolute top-2 right-2'>
            <Button
              variant='ghost'
              size='icon'
              className='h-5 w-5 hover:bg-card'
              onClick={handleClearSelection}
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
          <div className='flex items-center gap-3 pr-4'>
            <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-muted/20'>
              <ConfluenceIcon className='h-4 w-4' />
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <div className='flex items-center gap-1'>
                <h4 className='truncate font-medium text-xs'>{activeFile.name}</h4>
                {activeFile.modifiedTime && (
                  <span className='whitespace-nowrap text-muted-foreground text-xs'>
                    {new Date(activeFile.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              {activeFile.webViewLink ? (
                <a
                  href={activeFile.webViewLink}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-1 text-foreground text-xs hover:underline'
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{copy.openInConfluence}</span>
                  <ExternalLink className='h-3 w-3' />
                </a>
              ) : (
                <></>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
