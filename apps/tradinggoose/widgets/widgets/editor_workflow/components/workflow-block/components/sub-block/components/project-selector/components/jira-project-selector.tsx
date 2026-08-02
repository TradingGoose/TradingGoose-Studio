'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { JiraIcon } from '@/components/icons/icons'
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
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'

const logger = createLogger('JiraProjectSelector')

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError'

export interface JiraProjectInfo {
  id: string
  key: string
  name: string
  url?: string
  avatarUrl?: string
  description?: string
  projectTypeKey?: string
  simplified?: boolean
  style?: string
  isPrivate?: boolean
}

interface JiraProjectSelectorProps {
  value: string
  onChange: (value: string, projectInfo?: JiraProjectInfo) => void
  provider: OAuthProvider
  label?: string
  disabled?: boolean
  domain: string
  showPreview?: boolean
  credentialId: string
  isForeignCredential?: boolean
  workflowId?: string
  workspaceId?: string
}

export function JiraProjectSelector({
  value,
  onChange,
  provider,
  label,
  disabled = false,
  domain,
  showPreview = true,
  credentialId,
  isForeignCredential = false,
  workflowId,
  workspaceId,
}: JiraProjectSelectorProps) {
  const locale = useLocale() as LocaleCode
  const selectorCopy = useMessages().workspace.widgets.blockEditor.jiraProjectSelector
  const labelText = label ?? translateWorkflowLabel(locale, 'selectJiraProject')
  const feedbackId = useId()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<JiraProjectInfo[]>([])
  const [selectedProject, setSelectedProject] = useState<{
    context: string
    info: JiraProjectInfo | null
  } | null>(null)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [errorKey, setErrorKey] = useState<keyof typeof selectorCopy.errors | null>(null)
  const [cloudBinding, setCloudBinding] = useState<{
    id: string
    owner: string
  } | null>(null)
  const errorMessage = errorKey ? selectorCopy.errors[errorKey] : null
  const isLoading = pendingRequests > 0
  const announcedError = isLoading ? null : errorMessage

  const normalizedDomain = domain.trim().toLowerCase()
  const cloudContext = JSON.stringify([
    provider,
    workflowId ?? '',
    workspaceId ?? '',
    credentialId,
    normalizedDomain,
  ])
  const listContext = JSON.stringify([cloudContext, isForeignCredential])
  const selectionContext = JSON.stringify([cloudContext, value, isForeignCredential])
  const activeCloudId = cloudBinding?.owner === cloudContext ? cloudBinding.id : undefined
  const activeProject =
    selectedProject?.context === selectionContext && selectedProject.info?.id === value
      ? selectedProject.info
      : null
  const mountedRef = useRef(false)
  const projectsRequestRef = useRef(0)
  const selectionRequestRef = useRef(0)
  const feedbackRequestRef = useRef(0)
  const searchIntentRef = useRef(0)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const projectsAbortRef = useRef<AbortController | null>(null)
  const selectionAbortRef = useRef<AbortController | null>(null)
  const selectorContextRef = useRef({
    cloud: cloudContext,
    list: listContext,
    selection: selectionContext,
  })
  selectorContextRef.current = {
    cloud: cloudContext,
    list: listContext,
    selection: selectionContext,
  }
  const previousListContextRef = useRef(listContext)
  const previousCloudContextRef = useRef(cloudContext)
  const previousSelectionContextRef = useRef(selectionContext)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      projectsRequestRef.current += 1
      selectionRequestRef.current += 1
      feedbackRequestRef.current += 1
      searchIntentRef.current += 1
      projectsAbortRef.current?.abort()
      selectionAbortRef.current?.abort()
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (previousListContextRef.current === listContext) return
    previousListContextRef.current = listContext
    projectsRequestRef.current += 1
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    searchIntentRef.current += 1
    projectsAbortRef.current?.abort()
    selectionAbortRef.current?.abort()
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    setProjects([])
    setSelectedProject(null)
    setErrorKey(null)
  }, [listContext])

  useEffect(() => {
    if (previousCloudContextRef.current === cloudContext) return
    previousCloudContextRef.current = cloudContext
    setCloudBinding(null)
  }, [cloudContext])

  const handleSearch = (query: string) => {
    const searchIntent = ++searchIntentRef.current
    projectsRequestRef.current += 1
    projectsAbortRef.current?.abort()
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    const requestContext = selectorContextRef.current.list
    searchTimeoutRef.current = setTimeout(() => {
      if (
        searchIntent !== searchIntentRef.current ||
        requestContext !== selectorContextRef.current.list
      ) {
        return
      }
      void fetchProjects(query, searchIntent)
    }, 500)
  }

  // Fetch detailed project information
  const fetchProjectInfo = useCallback(
    async (projectId: string) => {
      if (!credentialId || !domain || !projectId) return

      selectionAbortRef.current?.abort()
      const controller = new AbortController()
      selectionAbortRef.current = controller
      const requestGeneration = ++selectionRequestRef.current
      const feedbackGeneration = ++feedbackRequestRef.current
      const requestContext = selectionContext
      const requestCloudContext = cloudContext

      setPendingRequests((count) => count + 1)
      if (feedbackGeneration === feedbackRequestRef.current) setErrorKey(null)

      try {
        const response = await fetch(`/api/tools/jira/projects`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain,
            credentialId,
            ...(workflowId ? { workflowId } : workspaceId ? { workspaceId } : {}),
            projectId,
            cloudId: activeCloudId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error('failedToFetchProjectDetails')
        }

        const json = await response.json()
        const projectInfo = json?.project
        const newCloudId = json?.cloudId
        if (
          !mountedRef.current ||
          requestGeneration !== selectionRequestRef.current ||
          requestContext !== selectorContextRef.current.selection
        ) {
          return
        }

        if (newCloudId) {
          setCloudBinding({ id: newCloudId, owner: requestCloudContext })
        }

        setSelectedProject({ context: requestContext, info: projectInfo || null })
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Error fetching project details:', error)
          if (
            mountedRef.current &&
            requestGeneration === selectionRequestRef.current &&
            feedbackGeneration === feedbackRequestRef.current &&
            requestContext === selectorContextRef.current.selection
          ) {
            setErrorKey('failedToFetchProjectDetails')
            setSelectedProject({ context: requestContext, info: null })
          }
        }
      } finally {
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1))
        }
      }
    },
    [credentialId, domain, activeCloudId, cloudContext, selectionContext, workflowId, workspaceId]
  )

  // Fetch projects from Jira
  const fetchProjects = useCallback(
    async (searchQuery = '', requestIntent?: number) => {
      if (!credentialId || !domain) return
      const searchIntent = requestIntent ?? ++searchIntentRef.current
      if (searchIntent !== searchIntentRef.current) return

      projectsAbortRef.current?.abort()
      const controller = new AbortController()
      projectsAbortRef.current = controller
      const requestGeneration = ++projectsRequestRef.current
      const feedbackGeneration = ++feedbackRequestRef.current
      const requestContext = selectorContextRef.current.list
      const requestCloudContext = selectorContextRef.current.cloud
      const ownsRequest = () =>
        mountedRef.current &&
        requestGeneration === projectsRequestRef.current &&
        searchIntent === searchIntentRef.current &&
        requestContext === selectorContextRef.current.list

      // Validate domain format
      if (!normalizedDomain.includes('.')) {
        if (ownsRequest()) setProjects([])
        if (ownsRequest() && feedbackGeneration === feedbackRequestRef.current) {
          setErrorKey('invalidDomainFormat')
        }
        return
      }

      setPendingRequests((count) => count + 1)
      if (feedbackGeneration === feedbackRequestRef.current) setErrorKey(null)

      try {
        const queryParams = new URLSearchParams({
          domain,
          credentialId,
          ...(workflowId ? { workflowId } : workspaceId ? { workspaceId } : {}),
          ...(searchQuery && { query: searchQuery }),
          ...(activeCloudId && { cloudId: activeCloudId }),
        })

        // Use the GET endpoint for project search
        const response = await fetch(`/api/tools/jira/projects?${queryParams.toString()}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error('failedToFetchProjects')
        }

        const data = await response.json()
        if (!ownsRequest()) return

        if (data.cloudId) {
          setCloudBinding({ id: data.cloudId, owner: requestCloudContext })
        }

        // Process the projects results
        const foundProjects = data.projects || []
        logger.info(`Received ${foundProjects.length} projects from API`)
        setProjects(foundProjects)
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Error fetching projects:', error)
          if (ownsRequest() && feedbackGeneration === feedbackRequestRef.current) {
            setErrorKey('failedToFetchProjects')
          }
          if (ownsRequest()) setProjects([])
        }
      } finally {
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1))
        }
      }
    },
    [credentialId, domain, normalizedDomain, activeCloudId, workflowId, workspaceId]
  )

  useEffect(() => {
    if (previousSelectionContextRef.current === selectionContext) return
    previousSelectionContextRef.current = selectionContext
    if (activeProject) return
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setSelectedProject(null)
    setErrorKey(null)
  }, [selectionContext, activeProject])

  // Fetch the selected project metadata once credentials are ready or changed
  useEffect(() => {
    if (value && credentialId && normalizedDomain.includes('.') && !activeProject) {
      void fetchProjectInfo(value)
    }
  }, [value, credentialId, normalizedDomain, fetchProjectInfo, activeProject])

  // Handle open change
  const handleOpenChange = (isOpen: boolean) => {
    if (disabled || isForeignCredential) {
      setOpen(false)
      return
    }
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
    if (isOpen && credentialId && normalizedDomain.includes('.')) {
      const searchIntent = ++searchIntentRef.current
      void fetchProjects('', searchIntent)
    }
  }

  // Handle project selection
  const handleSelectProject = (project: JiraProjectInfo) => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setErrorKey(null)
    setSelectedProject({
      context: JSON.stringify([cloudContext, project.id, isForeignCredential]),
      info: project,
    })
    onChange(project.id, project)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setSelectedProject({ context: selectionContext, info: null })
    setErrorKey(null)
    onChange('', undefined)
  }

  const canShowPreview = !!(showPreview && activeProject)

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
              className='w-full justify-between'
              disabled={disabled || !domain || !credentialId || isForeignCredential}
            />
          }
        >
          {canShowPreview ? (
            <div className='flex items-center gap-1 overflow-hidden'>
              <JiraIcon className='h-4 w-4' />
              <span className='truncate font-normal'>{activeProject.name}</span>
            </div>
          ) : value ? (
            <div className='flex items-center gap-1 overflow-hidden'>
              <JiraIcon className='h-4 w-4' />
              <span className='truncate font-normal'>{value}</span>
            </div>
          ) : (
            <div className='flex items-center gap-1'>
              <JiraIcon className='h-4 w-4' />
              <span className='text-muted-foreground'>{labelText}</span>
            </div>
          )}
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </PopoverTrigger>
        {!isForeignCredential && (
          <PopoverContent className='w-[300px] p-0' align='start'>
            <Command>
              <CommandInput
                placeholder={translateWorkflowLabel(locale, 'searchProjects')}
                onValueChange={handleSearch}
              />
              <CommandList>
                <CommandEmpty>
                  {!isLoading && !errorMessage
                    ? translateWorkflowLabel(locale, 'noProjectsFound')
                    : null}
                </CommandEmpty>

                {/* Projects list */}
                {projects.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      {translateWorkflowLabel(locale, 'projects')}
                    </div>
                    {projects.map((project) => (
                      <CommandItem
                        key={project.id}
                        value={`project-${project.id}-${project.name}`}
                        onSelect={() => handleSelectProject(project)}
                      >
                        <div className='flex items-center gap-1 overflow-hidden'>
                          {project.avatarUrl ? (
                            <img
                              src={project.avatarUrl}
                              alt={project.name}
                              className='h-4 w-4 rounded'
                            />
                          ) : (
                            <JiraIcon className='h-4 w-4' />
                          )}
                          <span className='truncate font-normal'>{project.name}</span>
                        </div>
                        {project.id === value && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        )}
      </Popover>

      {isLoading ? (
        <p
          id={feedbackId}
          role='status'
          aria-atomic='true'
          className='text-muted-foreground text-xs'
        >
          {translateWorkflowLabel(locale, 'loading')}
        </p>
      ) : announcedError ? (
        <p id={feedbackId} role='alert' aria-atomic='true' className='text-destructive text-xs'>
          {announcedError}
        </p>
      ) : null}

      {/* Project preview */}
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
              {activeProject.avatarUrl ? (
                <img
                  src={activeProject.avatarUrl}
                  alt={activeProject.name}
                  className='h-4 w-4 rounded'
                />
              ) : (
                <JiraIcon className='h-4 w-4' />
              )}
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <div className='flex items-center gap-1'>
                <h4 className='truncate font-medium text-xs'>{activeProject.name}</h4>
                <span className='whitespace-nowrap text-muted-foreground text-xs'>
                  {activeProject.key}
                </span>
              </div>
              {activeProject.url && (
                <a
                  href={activeProject.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-1 text-foreground text-xs hover:underline'
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{translateWorkflowLabel(locale, 'openInJira')}</span>
                  <ExternalLink className='h-3 w-3' />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
