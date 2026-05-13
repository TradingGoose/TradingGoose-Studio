'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, FileIcon, FolderIcon, RefreshCw, X } from 'lucide-react'
import { GoogleDocsIcon, GoogleSheetsIcon } from '@/components/icons/icons'
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
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'

const logger = createLogger('GoogleDrivePicker')

export interface FileInfo {
  id: string
  name: string
  mimeType: string
  iconLink?: string
  webViewLink?: string
  thumbnailLink?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
  owners?: { displayName: string; emailAddress: string }[]
}

interface GoogleDrivePickerProps {
  value: string
  onChange: (value: string, fileInfo?: FileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  mimeTypeFilter?: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: FileInfo | null) => void
  credentialId?: string
  workflowId?: string
}

export function GoogleDrivePicker({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select file',
  disabled = false,
  serviceId,
  mimeTypeFilter,
  showPreview = true,
  onFileInfoChange,
  credentialId,
  workflowId,
}: GoogleDrivePickerProps) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [availableFiles, setAvailableFiles] = useState<FileInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [credentialsLoaded, setCredentialsLoaded] = useState(false)
  const initialFetchRef = useRef(false)

  // Determine the appropriate service ID based on provider and scopes
  const getServiceId = (): string => {
    if (serviceId) return serviceId
    return getServiceIdFromScopes(provider, requiredScopes)
  }

  // Determine the appropriate provider ID based on service and scopes
  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()
    return getProviderIdFromServiceId(effectiveServiceId)
  }

  // Fetch available credentials for this provider
  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    setCredentialsLoaded(false)
    try {
      const providerId = getProviderId()
      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)

      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)
        if (credentialId && !data.credentials.some((c: any) => c.id === credentialId)) {
          setSelectedCredentialId('')
        }
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
      setCredentialsLoaded(true)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Prefer persisted credentialId if provided
  useEffect(() => {
    if (credentialId && credentialId !== selectedCredentialId) {
      setSelectedCredentialId(credentialId)
    }
  }, [credentialId, selectedCredentialId])

  // Fetch a single file by ID when we have a selectedFileId but no metadata
  const fetchFileById = useCallback(
    async (fileId: string) => {
      if (!selectedCredentialId || !fileId) return null

      setIsLoadingSelectedFile(true)
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
          fileId: fileId,
        })
        if (workflowId) queryParams.set('workflowId', workflowId)

        const response = await fetch(`/api/tools/drive/file?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.file) {
            setSelectedFile(data.file)
            onFileInfoChange?.(data.file)
            return data.file
          }
        } else {
          const errorText = await response.text()
          logger.error('Error fetching file by ID:', { error: errorText })

          // If file not found or access denied, clear the selection
          if (response.status === 404 || response.status === 403) {
            logger.info('File not accessible, clearing selection')
            setSelectedFileId('')
            onChange('')
            onFileInfoChange?.(null)
          }

          if (response.status === 401) {
            logger.info('Credential unauthorized (401), clearing selection and prompting re-auth')
            setSelectedFileId('')
            onChange('')
            onFileInfoChange?.(null)
            setShowOAuthModal(true)
          }
        }
        return null
      } catch (error) {
        logger.error('Error fetching file by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedFile(false)
      }
    },
    [selectedCredentialId, onChange, onFileInfoChange, workflowId]
  )

  const fetchAvailableFiles = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoadingFiles(true)
    try {
      const queryParams = new URLSearchParams({
        credentialId: selectedCredentialId,
      })
      if (workflowId) queryParams.set('workflowId', workflowId)
      if (mimeTypeFilter) queryParams.set('mimeType', mimeTypeFilter)
      if (searchQuery.trim()) queryParams.set('query', searchQuery.trim())

      const response = await fetch(`/api/tools/drive/files?${queryParams.toString()}`)

      if (response.ok) {
        const data = await response.json()
        setAvailableFiles(data.files || [])
      } else {
        logger.error('Error fetching Drive files:', { error: await response.text() })
        setAvailableFiles([])
      }
    } catch (error) {
      logger.error('Error fetching Drive files:', { error })
      setAvailableFiles([])
    } finally {
      setIsLoadingFiles(false)
    }
  }, [selectedCredentialId, workflowId, mimeTypeFilter, searchQuery])

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Keep internal selectedFileId in sync with the value prop
  useEffect(() => {
    if (value !== selectedFileId) {
      const previousFileId = selectedFileId
      setSelectedFileId(value)
      // Only clear selected file info if we had a different file before (not initial load)
      if (previousFileId && previousFileId !== value && selectedFile) {
        setSelectedFile(null)
      }
    }
  }, [value, selectedFileId, selectedFile])

  // Track previous credential ID to detect changes
  const prevCredentialIdRef = useRef<string>('')

  // Clear selected file when credentials are removed or changed
  useEffect(() => {
    const prevCredentialId = prevCredentialIdRef.current
    prevCredentialIdRef.current = selectedCredentialId

    if (!selectedCredentialId) {
      // No credentials - clear everything
      if (selectedFile) {
        setSelectedFile(null)
        setSelectedFileId('')
        onChange('')
      }
    } else if (prevCredentialId && prevCredentialId !== selectedCredentialId) {
      // Credentials changed (not initial load) - clear file info to force refetch
      if (selectedFile) {
        setSelectedFile(null)
      }
    }
  }, [selectedCredentialId, selectedFile, onChange])

  // Fetch the selected file metadata once credentials are loaded or changed
  useEffect(() => {
    // Only fetch if we have both a file ID and credentials, credentials are loaded, but no file info yet
    if (
      value &&
      selectedCredentialId &&
      credentialsLoaded &&
      !selectedFile &&
      !isLoadingSelectedFile
    ) {
      fetchFileById(value)
    }
  }, [
    value,
    selectedCredentialId,
    credentialsLoaded,
    selectedFile,
    isLoadingSelectedFile,
    fetchFileById,
  ])

  useEffect(() => {
    if (!open || !selectedCredentialId) return
    const timeout = setTimeout(() => {
      void fetchAvailableFiles()
    }, 250)
    return () => clearTimeout(timeout)
  }, [open, selectedCredentialId, fetchAvailableFiles])

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  const handleFileSelect = (file: FileInfo) => {
    setSelectedFileId(file.id)
    setSelectedFile(file)
    onChange(file.id, file)
    onFileInfoChange?.(file)
    setOpen(false)
    setSearchQuery('')
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-4 w-4' />
    }

    // For compound providers, find the specific service
    if (providerName.includes('-')) {
      for (const service of Object.values(baseProviderConfig.services)) {
        if (service.providerId === providerName) {
          return service.icon({ className: 'h-4 w-4' })
        }
      }
    }

    // Fallback to base provider icon
    return baseProviderConfig.icon({ className: 'h-4 w-4' })
  }

  // Get provider name
  const getProviderName = (providerName: OAuthProvider) => {
    const effectiveServiceId = getServiceId()
    try {
      // First try to get the service by provider and service ID
      const service = getServiceByProviderAndId(providerName, effectiveServiceId)
      return service.name
    } catch (_error) {
      // If that fails, try to get the service by parsing the provider
      try {
        const { baseProvider } = parseProvider(providerName)
        const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

        // For compound providers like 'google-drive', try to find the specific service
        if (providerName.includes('-')) {
          const serviceKey = providerName.split('-')[1] || ''
          for (const [key, service] of Object.entries(baseProviderConfig?.services || {})) {
            if (key === serviceKey || key === providerName || service.providerId === providerName) {
              return service.name
            }
          }
        }

        // Fallback to provider name if service not found
        if (baseProviderConfig) {
          return baseProviderConfig.name
        }
      } catch (_parseError) {
        // Ignore parse error and continue to final fallback
      }

      // Final fallback: capitalize the provider name
      return providerName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  // Get file icon based on mime type
  const getFileIcon = (file: FileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.google-apps.folder') {
      return <FolderIcon className={`${iconSize} text-muted-foreground`} />
    }
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <GoogleSheetsIcon className={iconSize} />
    }
    if (file.mimeType === 'application/vnd.google-apps.document') {
      return <GoogleDocsIcon className={iconSize} />
    }
    return <FileIcon className={`${iconSize} text-muted-foreground`} />
  }

  const canShowPreview = !!(
    showPreview &&
    selectedFile &&
    selectedFileId &&
    selectedFile.id === selectedFileId
  )

  return (
    <>
      <div className='space-y-2'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled || isLoading}
              onClick={() => {
                if (!selectedCredentialId && credentials.length === 1) {
                  setSelectedCredentialId(credentials[0].id)
                } else if (!selectedCredentialId) {
                  handleAddCredential()
                }
              }}
            >
              <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
                {canShowPreview ? (
                  <>
                    {getFileIcon(selectedFile, 'sm')}
                    <span className='truncate font-normal'>{selectedFile.name}</span>
                  </>
                ) : selectedFileId && isLoadingSelectedFile && selectedCredentialId ? (
                  <>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='truncate text-muted-foreground'>Loading document...</span>
                  </>
                ) : (
                  <>
                    {getProviderIcon(provider)}
                    <span className='truncate text-muted-foreground'>{label}</span>
                  </>
                )}
              </div>
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          {selectedCredentialId && (
            <PopoverContent className='w-[320px] p-0' align='start'>
              <Command>
                <CommandInput
                  placeholder='Search Drive files...'
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {isLoadingFiles ? (
                      <div className='flex items-center justify-center p-4'>
                        <RefreshCw className='h-4 w-4 animate-spin' />
                        <span className='ml-2'>Loading...</span>
                      </div>
                    ) : (
                      <div className='p-4 text-center'>
                        <p className='font-medium text-sm'>No files found.</p>
                      </div>
                    )}
                  </CommandEmpty>
                  {availableFiles.length > 0 && (
                    <CommandGroup>
                      {availableFiles.map((file) => (
                        <CommandItem
                          key={file.id}
                          value={`file-${file.id}-${file.name}`}
                          onSelect={() => handleFileSelect(file)}
                        >
                          <div className='flex min-w-0 items-center gap-2'>
                            {getFileIcon(file, 'sm')}
                            <span className='truncate font-normal'>{file.name}</span>
                          </div>
                          {file.id === selectedFileId && <Check className='ml-auto h-4 w-4' />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          )}
        </Popover>

        {/* File preview */}
        {canShowPreview && (
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
                {getFileIcon(selectedFile, 'sm')}
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-1'>
                  <h4 className='truncate font-medium text-xs'>{selectedFile.name}</h4>
                  {selectedFile.modifiedTime && (
                    <span className='whitespace-nowrap text-muted-foreground text-xs'>
                      {new Date(selectedFile.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {selectedFile.webViewLink ? (
                  <a
                    href={selectedFile.webViewLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-muted-foreground text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <a
                    href={`https://drive.google.com/file/d/${selectedFile.id}/view`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-muted-foreground text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
