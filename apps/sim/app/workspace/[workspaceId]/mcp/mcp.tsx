'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, Pencil, Plus, Search, Server, Trash2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTransport } from '@/lib/mcp/types'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import type { McpToolForUI } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'

const logger = createLogger('McpServers')

interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: Record<string, string>
}

const createDefaultFormState = (): McpServerFormData => ({
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: {},
})

export function McpServers() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const { mcpTools, error: toolsError, refreshTools } = useMcpTools(workspaceId)
  const {
    servers,
    isLoading: serversLoading,
    error: serversError,
    fetchServers,
    createServer,
    updateServer,
    deleteServer,
  } = useMcpServersStore()

  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState<McpServerFormData>(() => createDefaultFormState())

  // Environment variable dropdown state
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<
    'url' | 'header-key' | 'header-value' | null
  >(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const formContainerRef = useRef<HTMLDivElement>(null)

  // MCP server testing
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  // Loading state for adding server
  const [isSavingServer, setIsSavingServer] = useState(false)

  // State for tracking input scroll position
  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})
  const resetFormState = useCallback(() => {
    setFormData(createDefaultFormState())
    setShowEnvVars(false)
    setActiveInputField(null)
    setActiveHeaderIndex(null)
    setUrlScrollLeft(0)
    setHeaderScrollLeft({})
    clearTestResult()
  }, [clearTestResult])

  const closeForm = useCallback(() => {
    setFormMode(null)
    setEditingServerId(null)
    resetFormState()
  }, [resetFormState])

  const handleStartCreate = useCallback(() => {
    setFormMode('create')
    setEditingServerId(null)
    resetFormState()
  }, [resetFormState])

  const handleStartEdit = useCallback(
    (server: McpServerWithStatus) => {
      setFormMode('edit')
      setEditingServerId(server.id)
      setFormData({
        name: server.name || '',
        transport: server.transport || 'streamable-http',
        url: server.url || '',
        timeout: server.timeout ?? 30000,
        headers: { ...(server.headers || {}) },
      })
      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
      setUrlScrollLeft(0)
      setHeaderScrollLeft({})
      clearTestResult()
    },
    [clearTestResult]
  )

  // Handle environment variable selection
  const handleEnvVarSelect = useCallback(
    (newValue: string) => {
      if (activeInputField === 'url') {
        setFormData((prev) => ({ ...prev, url: newValue }))
      } else if (activeInputField === 'header-key' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [oldKey, value] = headerEntries[activeHeaderIndex]
        const newHeaders = { ...formData.headers }
        delete newHeaders[oldKey]
        newHeaders[newValue.replace(/[{}]/g, '')] = value
        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (activeInputField === 'header-value' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[activeHeaderIndex]
        setFormData((prev) => ({
          ...prev,
          headers: { ...prev.headers, [key]: newValue },
        }))
      }
      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
    },
    [activeInputField, activeHeaderIndex, formData.headers]
  )

  // Handle input change with env var detection
  const handleInputChange = useCallback(
    (field: 'url' | 'header-key' | 'header-value', value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement
      const pos = input?.selectionStart || 0

      setCursorPosition(pos)

      // Clear test result when any field changes
      if (testResult) {
        clearTestResult()
      }

      // Check if we should show the environment variables dropdown
      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setActiveInputField(field)
        setActiveHeaderIndex(headerIndex ?? null)
      } else {
        setActiveInputField(null)
        setActiveHeaderIndex(null)
      }

      // Update form data
      if (field === 'url') {
        setFormData((prev) => ({ ...prev, url: value }))
      } else if (field === 'header-key' && headerIndex !== undefined) {
        const headerEntries = Object.entries(formData.headers || {})
        const [oldKey, headerValue] = headerEntries[headerIndex]
        const newHeaders = { ...formData.headers }
        delete newHeaders[oldKey]
        newHeaders[value] = headerValue
        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (field === 'header-value' && headerIndex !== undefined) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[headerIndex]
        setFormData((prev) => ({
          ...prev,
          headers: { ...prev.headers, [key]: value },
        }))
      }
    },
    [formData.headers]
  )

  const handleTestConnection = useCallback(async () => {
    if (!workspaceId || !formData.name.trim() || !formData.url?.trim()) return

    await testConnection({
      name: formData.name,
      transport: formData.transport,
      url: formData.url,
      headers: formData.headers,
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, testConnection, workspaceId])

  const handleCreateServer = useCallback(async () => {
    if (!workspaceId || !formData.name.trim()) return

    setIsSavingServer(true)
    try {
      // If no test has been done, test first
      if (!testResult) {
        const result = await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: formData.headers,
          timeout: formData.timeout,
          workspaceId,
        })

        // If test fails, don't proceed
        if (!result.success) {
          return
        }
      }

      // If we have a failed test result, don't proceed
      if (testResult && !testResult.success) {
        return
      }

      await createServer(workspaceId, {
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: formData.headers,
        enabled: true,
      })

      logger.info(`Added MCP server: ${formData.name}`)

      // Reset form and hide form immediately after server creation
      setFormData({
        name: '',
        transport: 'streamable-http',
        url: '',
        timeout: 30000,
        headers: {}, // Reset with no headers
      })
      closeForm()

      // Refresh tools in the background without waiting
      refreshTools(true) // Force refresh after adding server
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
    } finally {
      setIsSavingServer(false)
    }
  }, [formData, testResult, testConnection, createServer, refreshTools, closeForm, workspaceId])

  const handleUpdateServer = useCallback(async () => {
    if (!workspaceId || !editingServerId || !formData.name.trim()) return

    setIsSavingServer(true)
    try {
      // validate connection before saving if needed
      if (!testResult) {
        await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: formData.headers,
          timeout: formData.timeout,
          workspaceId,
        })
      }

      await updateServer(workspaceId, editingServerId, {
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: formData.headers,
      })

      closeForm()
      refreshTools(true)
      logger.info(`Updated MCP server: ${editingServerId}`)
    } catch (error) {
      logger.error('Failed to update MCP server:', error)
    } finally {
      setIsSavingServer(false)
    }
  }, [
    workspaceId,
    editingServerId,
    formData,
    testResult,
    testConnection,
    updateServer,
    closeForm,
    refreshTools,
  ])

  const handleRemoveServer = useCallback(
    async (serverId: string) => {
      if (!workspaceId) return
      // Add server to deleting set
      setDeletingServers((prev) => new Set(prev).add(serverId))

      try {
        await deleteServer(workspaceId, serverId)
        await refreshTools(true) // Force refresh after removing server

        if (editingServerId === serverId) {
          closeForm()
        }

        logger.info(`Removed MCP server: ${serverId}`)
      } catch (error) {
        logger.error('Failed to remove MCP server:', error)
        // Remove from deleting set on error so user can try again
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      } finally {
        // Remove from deleting set after successful deletion
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      }
    },
    [deleteServer, refreshTools, workspaceId, editingServerId, closeForm]
  )

  // Load data on mount only
  useEffect(() => {
    if (!workspaceId) return
    fetchServers(workspaceId)
    refreshTools() // Don't force refresh on mount
  }, [fetchServers, refreshTools, workspaceId])

  useEffect(() => {
    if (formMode && formContainerRef.current) {
      formContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [formMode])

  const toolsByServer = (mcpTools || []).reduce(
    (acc, tool) => {
      if (!tool || !tool.serverId) {
        return acc // Skip invalid tools
      }
      if (!acc[tool.serverId]) {
        acc[tool.serverId] = []
      }
      acc[tool.serverId].push(tool)
      return acc
    },
    {} as Record<string, typeof mcpTools>
  )

  // Filter servers based on search term
  const filteredServers = (servers || []).filter((server) =>
    server.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )
  const hasServers = Array.isArray(servers) && servers.length > 0
  const showNoResults = hasServers && searchTerm.trim().length > 0 && filteredServers.length === 0
  const isFormVisible = formMode !== null
  const formActionLabel = formMode === 'edit' ? 'Save Changes' : 'Add Server'

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Server className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>MCP Servers</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search servers...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRightContent = (
    <PrimaryButton onClick={handleStartCreate} disabled={serversLoading}>
      <Plus className='h-3.5 w-3.5' />
      <span>Add Server</span>
    </PrimaryButton>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} right={headerRightContent} />
      <div className='flex h-screen flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex-1 overflow-auto'>
              <div className='relative flex h-full flex-col'>
                <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
                  <div className='space-y-6 py-6'>
                    {(toolsError || serversError) && (
                      <Alert variant='destructive'>
                        <AlertCircle className='h-4 w-4' />
                        <AlertDescription>{toolsError || serversError}</AlertDescription>
                      </Alert>
                    )}

                    {serversLoading ? (
                      <div className='space-y-4'>
                        <McpServerSkeleton />
                        <McpServerSkeleton />
                        <McpServerSkeleton />
                      </div>
                    ) : (
                      <>
                        {hasServers ? (
                          <div className='space-y-4'>
                            {filteredServers.map((server) => {
                              if (!server || !server.id) {
                                return null
                              }
                              return (
                                <ServerCard
                                  key={server.id}
                                  server={server}
                                  tools={toolsByServer[server.id] || []}
                                  onEdit={handleStartEdit}
                                  onDelete={handleRemoveServer}
                                  isDeleting={deletingServers.has(server.id)}
                                />
                              )
                            })}
                          </div>
                        ) : (
                          <div className='rounded-2xl border bg-card p-10 text-center shadow-sm'>
                            <p className='font-medium'>No MCP servers yet</p>
                            <p className='mt-2 text-muted-foreground'>
                              Configure MCP servers to extend your workflows with custom tools.
                            </p>
                            <Button className='mt-4' onClick={handleStartCreate}>
                              <Plus className='mr-2 h-4 w-4 stroke-[2px]' />
                              Add Server
                            </Button>
                          </div>
                        )}

                        {showNoResults && (
                          <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
                            No servers found matching "{searchTerm}"
                          </div>
                        )}
                      </>
                    )}

                    {isFormVisible && (
                      <div ref={formContainerRef} className='rounded-md border bg-background p-5 shadow-xs'>
                        <div className='mb-4'>
                          <h3 className='font-medium text-base'>
                            {formMode === 'edit' ? 'Edit MCP Server' : 'Add MCP Server'}
                          </h3>
                          <p className='text-muted-foreground text-sm'>
                            {formMode === 'edit'
                              ? 'Update an existing MCP server configuration.'
                              : 'Configure a new MCP server for this workspace.'}
                          </p>
                        </div>

                        <div className='space-y-3'>
                          <div className='flex items-center justify-between'>
                            <div className='w-full'>
                              <Label className='font-normal'>Server Name</Label>
                            </div>
                            <div className='w-full'>
                              <Input
                                placeholder='e.g., My MCP Server'
                                value={formData.name}
                                onChange={(e) => {
                                  if (testResult) clearTestResult()
                                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                                }}
                                className='h-9'
                              />
                            </div>
                          </div>

                          <div className='flex items-center justify-between'>
                            <div className='w-full'>
                              <Label className='font-normal'>Transport</Label>
                            </div>
                            <div className='w-full'>
                              <Select
                                value={formData.transport}
                                onValueChange={(value: 'http' | 'sse' | 'streamable-http') => {
                                  if (testResult) clearTestResult()
                                  setFormData((prev) => ({ ...prev, transport: value }))
                                }}
                              >
                                <SelectTrigger className='h-9'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='streamable-http'>Streamable HTTP</SelectItem>
                                  <SelectItem value='http'>HTTP</SelectItem>
                                  <SelectItem value='sse'>Server-Sent Events</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className='flex items-center justify-between'>
                            <div className='w-full'>
                              <Label className='font-normal'>Server URL</Label>
                            </div>
                            <div className='relative w-full'>
                              <Input
                                ref={urlInputRef}
                                placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                                value={formData.url}
                                onChange={(e) => handleInputChange('url', e.target.value)}
                                onScroll={(e) => {
                                  const scrollLeft = e.currentTarget.scrollLeft
                                  setUrlScrollLeft(scrollLeft)
                                }}
                                onInput={(e) => {
                                  const scrollLeft = e.currentTarget.scrollLeft
                                  setUrlScrollLeft(scrollLeft)
                                }}
                                className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                              />
                              <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                                <div
                                  className='whitespace-nowrap'
                                  style={{ transform: `translateX(-${urlScrollLeft}px)` }}
                                >
                                  {formatDisplayText(formData.url || '')}
                                </div>
                              </div>

                              {showEnvVars && activeInputField === 'url' && (
                                <EnvVarDropdown
                                  visible={showEnvVars}
                                  onSelect={handleEnvVarSelect}
                                  searchTerm={envSearchTerm}
                                  inputValue={formData.url || ''}
                                  cursorPosition={cursorPosition}
                                  workspaceId={workspaceId}
                                  onClose={() => {
                                    setShowEnvVars(false)
                                    setActiveInputField(null)
                                  }}
                                  className='w-full'
                                  maxHeight='200px'
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    zIndex: 99999,
                                  }}
                                />
                              )}
                            </div>
                          </div>

                          {Object.entries(formData.headers || {}).map(([key, value], index) => (
                            <div key={index} className='relative flex items-center justify-between'>
                              <div className='w-full'>
                                <Label className='font-normal'>Header</Label>
                              </div>
                              <div className='relative flex w-full gap-2'>
                                <div className='relative flex-1'>
                                  <Input
                                    placeholder='Name'
                                    value={key}
                                    onChange={(e) => handleInputChange('header-key', e.target.value, index)}
                                    onScroll={(e) => {
                                      const scrollLeft = e.currentTarget.scrollLeft
                                      setHeaderScrollLeft((prev) => ({ ...prev, [`key-${index}`]: scrollLeft }))
                                    }}
                                    onInput={(e) => {
                                      const scrollLeft = e.currentTarget.scrollLeft
                                      setHeaderScrollLeft((prev) => ({ ...prev, [`key-${index}`]: scrollLeft }))
                                    }}
                                    className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                                  />
                                  <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                                    <div
                                      className='whitespace-nowrap'
                                      style={{ transform: `translateX(-${headerScrollLeft[`key-${index}`] || 0}px)` }}
                                    >
                                      {formatDisplayText(key || '')}
                                    </div>
                                  </div>
                                </div>

                                {showEnvVars &&
                                  activeInputField === 'header-key' &&
                                  activeHeaderIndex === index && (
                                    <EnvVarDropdown
                                      visible={showEnvVars}
                                      onSelect={handleEnvVarSelect}
                                      searchTerm={envSearchTerm}
                                      inputValue={key}
                                      cursorPosition={cursorPosition}
                                      workspaceId={workspaceId}
                                      onClose={() => {
                                        setShowEnvVars(false)
                                        setActiveInputField(null)
                                        setActiveHeaderIndex(null)
                                      }}
                                      className='w-full'
                                      maxHeight='200px'
                                      style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        zIndex: 99999,
                                      }}
                                    />
                                  )}

                                <div className='relative flex-1'>
                                  <Input
                                    placeholder='Value'
                                    value={value}
                                    onChange={(e) => handleInputChange('header-value', e.target.value, index)}
                                    onScroll={(e) => {
                                      const scrollLeft = e.currentTarget.scrollLeft
                                      setHeaderScrollLeft((prev) => ({ ...prev, [`value-${index}`]: scrollLeft }))
                                    }}
                                    onInput={(e) => {
                                      const scrollLeft = e.currentTarget.scrollLeft
                                      setHeaderScrollLeft((prev) => ({ ...prev, [`value-${index}`]: scrollLeft }))
                                    }}
                                    className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                                  />
                                  <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                                    <div
                                      className='whitespace-nowrap'
                                      style={{ transform: `translateX(-${headerScrollLeft[`value-${index}`] || 0}px)` }}
                                    >
                                      {formatDisplayText(value || '')}
                                    </div>
                                  </div>
                                </div>

                                {showEnvVars &&
                                  activeInputField === 'header-value' &&
                                  activeHeaderIndex === index && (
                                    <EnvVarDropdown
                                      visible={showEnvVars}
                                      onSelect={handleEnvVarSelect}
                                      searchTerm={envSearchTerm}
                                      inputValue={value}
                                      cursorPosition={cursorPosition}
                                      workspaceId={workspaceId}
                                      onClose={() => {
                                        setShowEnvVars(false)
                                        setActiveInputField(null)
                                        setActiveHeaderIndex(null)
                                      }}
                                      className='w-full'
                                      maxHeight='200px'
                                      style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        zIndex: 99999,
                                      }}
                                    />
                                  )}

                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => {
                                    const newHeaders = { ...formData.headers }
                                    delete newHeaders[key]
                                    setFormData((prev) => ({ ...prev, headers: newHeaders }))
                                  }}
                                  className='h-9 w-9 p-0 text-muted-foreground hover:text-foreground'
                                >
                                  <X className='h-3 w-3' />
                                </Button>
                              </div>
                            </div>
                          ))}

                          <div className='flex items-center justify-center  py-4'>

                            <Button
                              type='button'
                              variant='secondary'
                              size='sm'
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  headers: { ...(prev.headers || {}), '': '' },
                                }))
                              }}
                              className='h-9 text-muted-foreground hover:text-foreground'
                            >
                              <Plus className='mr-2 h-3 w-3' />
                              Add Header
                            </Button>

                          </div>

                          <div className='border-t pt-4'>
                            <div className='flex items-center justify-between'>
                              <div className='w-full justify-start flex items-center gap-3'>
                                <Button
                                  variant='outline'
                                  size='sm'
                                  onClick={handleTestConnection}
                                  disabled={
                                    isTestingConnection || !formData.name.trim() || !formData.url?.trim()
                                  }
                                  className='text-muted-foreground hover:text-foreground'
                                >
                                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                                </Button>
                                {testResult?.success && (
                                  <span className='text-green-600 text-xs'>✓ Connected</span>
                                )}
                              </div>
                              <div className='w-full justify-end flex items-center gap-3'>
                                {testResult && !testResult.success && (
                                  <span className='text-red-600 text-xs'>
                                    {testResult.error || testResult.message}
                                  </span>
                                )}
                                <Button variant='ghost' size='sm' onClick={closeForm}>
                                  Cancel
                                </Button>
                                <Button
                                  size='sm'
                                  onClick={formMode === 'edit' ? handleUpdateServer : handleCreateServer}
                                  disabled={
                                    serversLoading ||
                                    isSavingServer ||
                                    !formData.name.trim() ||
                                    !formData.url?.trim()
                                  }
                                >
                                  {isSavingServer ? 'Saving...' : formActionLabel}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function McpServerSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-40 rounded-sm' /> {/* Server name */}
          <Skeleton className='h-4 w-16' /> {/* Transport type */}
          <Skeleton className='h-1 w-1 rounded-full' /> {/* Dot separator */}
          <Skeleton className='h-4 w-12' /> {/* Tool count */}
        </div>
        <Skeleton className='h-8 w-16' /> {/* Delete button */}
      </div>
      <div className='mt-1 ml-2 flex flex-wrap gap-1'>
        <Skeleton className='h-5 w-16 rounded' /> {/* Tool name 1 */}
        <Skeleton className='h-5 w-20 rounded' /> {/* Tool name 2 */}
        <Skeleton className='h-5 w-14 rounded' /> {/* Tool name 3 */}
      </div>
    </div>
  )
}

interface ServerCardProps {
  server: McpServerWithStatus
  tools: McpToolForUI[]
  onEdit: (server: McpServerWithStatus) => void
  onDelete: (serverId: string) => void
  isDeleting: boolean
}

function formatRelativeTime(dateString?: string) {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 604800)}w ago`
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`
  return `${Math.floor(diffInSeconds / 31536000)}y ago`
}

function formatAbsoluteDate(dateString?: string) {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ServerCard({ server, tools, onEdit, onDelete, isDeleting }: ServerCardProps) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    if (!server.id) return
    try {
      await navigator.clipboard.writeText(server.id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className='group rounded-md border bg-card/40 p-4 transition-colors hover:bg-card'>
      <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
            <Server className='h-4 w-4 text-muted-foreground' />
            <span>{server.name || 'Unnamed Server'}</span>
            <span className='rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
              {server.transport?.toUpperCase() || 'HTTP'}
            </span>
            <div className='flex flex-wrap gap-2 text-muted-foreground text-[11px]'>
              {server.updatedAt && (
                <span title={`Updated ${formatAbsoluteDate(server.updatedAt)}`}>
                  Updated {formatRelativeTime(server.updatedAt)}
                </span>
              )}
              {server.createdAt && (
                <span title={`Created ${formatAbsoluteDate(server.createdAt)}`}>
                  Created {formatRelativeTime(server.createdAt)}
                </span>
              )}
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
            <span className='font-mono'>{server.id?.slice(0, 8) || '—'}</span>
            <button
              onClick={handleCopy}
              className='flex h-5 w-5 items-center justify-center rounded border border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            >
              {isCopied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
            </button>
            <span>•</span>
            <span>
              {tools.length} tool{tools.length === 1 ? '' : 's'}
            </span>
            {server.connectionStatus && (
              <>
                <span>•</span>
                <span className='capitalize'>{server.connectionStatus}</span>
              </>
            )}
          </div>
          <div className='grid gap-3 text-muted-foreground text-xs sm:grid-cols-3'>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>URL</p>
              <p className='text-foreground'>{server.url || '—'}</p>
            </div>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>Timeout</p>
              <p className='text-foreground'>{server.timeout ? `${server.timeout}ms` : '30,000ms'}</p>
            </div>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>Tools</p>
              <p className='text-foreground'>{tools.length}</p>
            </div>
          </div>
          {tools.length > 0 && (
            <div className='flex flex-wrap gap-2 pt-1'>
              {tools.map((tool) => (
                <span
                  key={tool.id}
                  className='inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground'
                >
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className='flex items-center justify-center gap-1 self-start'>
          <button
            type='button'
            onClick={() => onEdit(server)}
            className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          >
            <Pencil className='h-3.5 w-3.5' />
            <span className='sr-only'>Edit server</span>
          </button>
          <button
            type='button'
            onClick={() => onDelete(server.id)}
            disabled={isDeleting}
            className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
          >
            <Trash2 className='h-3.5 w-3.5' />
            <span className='sr-only'>Delete server</span>
          </button>
        </div>
      </div>
    </div>
  )
}
