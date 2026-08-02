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
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'

const logger = createLogger('JiraIssueSelector')

export interface JiraIssueInfo {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  modifiedTime?: string
  url?: string
}

interface JiraIssueSelectorProps {
  value: string
  onChange: (value: string, issueInfo?: JiraIssueInfo) => void
  provider: OAuthProvider
  label?: string
  disabled?: boolean
  domain: string
  showPreview?: boolean
  projectId?: string
  credentialId: string
  isForeignCredential?: boolean
  workflowId?: string
  workspaceId?: string
}

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError'

export function JiraIssueSelector({
  value,
  onChange,
  provider,
  label,
  disabled = false,
  domain,
  showPreview = true,
  projectId,
  credentialId,
  isForeignCredential = false,
  workflowId,
  workspaceId,
}: JiraIssueSelectorProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.workflowLabels
  const selectorCopy = useMessages().workspace.widgets.blockEditor.jiraIssueSelector
  const feedbackId = useId()
  const [open, setOpen] = useState(false)
  const [issues, setIssues] = useState<JiraIssueInfo[]>([])
  const [selectedIssue, setSelectedIssue] = useState<{
    context: string
    info: JiraIssueInfo | null
  } | null>(null)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [errorKey, setErrorKey] = useState<keyof typeof selectorCopy.errors | null>(null)
  const [cloudBinding, setCloudBinding] = useState<{
    id: string
    owner: string
  } | null>(null)
  const labelText = label ?? copy.selectJiraIssue
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
  const listContext = JSON.stringify([cloudContext, projectId ?? '', isForeignCredential])
  const selectionContext = JSON.stringify([cloudContext, value, isForeignCredential])
  const activeCloudId = cloudBinding?.owner === cloudContext ? cloudBinding.id : undefined
  const activeIssue =
    selectedIssue?.context === selectionContext && selectedIssue.info?.id === value
      ? selectedIssue.info
      : null
  const mountedRef = useRef(false)
  const issuesRequestRef = useRef(0)
  const selectionRequestRef = useRef(0)
  const feedbackRequestRef = useRef(0)
  const searchIntentRef = useRef(0)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const issuesAbortRef = useRef<AbortController | null>(null)
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
      issuesRequestRef.current += 1
      selectionRequestRef.current += 1
      feedbackRequestRef.current += 1
      searchIntentRef.current += 1
      issuesAbortRef.current?.abort()
      selectionAbortRef.current?.abort()
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (previousListContextRef.current === listContext) return
    previousListContextRef.current = listContext
    issuesRequestRef.current += 1
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    searchIntentRef.current += 1
    issuesAbortRef.current?.abort()
    selectionAbortRef.current?.abort()
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    setIssues([])
    setSelectedIssue(null)
    setErrorKey(null)
  }, [listContext])

  useEffect(() => {
    if (previousCloudContextRef.current === cloudContext) return
    previousCloudContextRef.current = cloudContext
    setCloudBinding(null)
  }, [cloudContext])

  const handleSearch = (query: string) => {
    const searchIntent = ++searchIntentRef.current
    issuesRequestRef.current += 1
    issuesAbortRef.current?.abort()
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    if (!query) {
      setIssues([])
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
      void fetchIssues(query, searchIntent)
    }, 500)
  }

  const fetchIssueInfo = useCallback(
    async (issueId: string) => {
      if (!credentialId || !domain) return

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
        const response = await fetch('/api/tools/jira/issue', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            domain,
            credentialId,
            ...(workflowId ? { workflowId } : workspaceId ? { workspaceId } : {}),
            issueId,
            cloudId: activeCloudId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Failed to fetch issue info:', errorData)
          throw new Error('failedToFetchIssueInfo')
        }

        const data = await response.json()
        if (
          !mountedRef.current ||
          requestGeneration !== selectionRequestRef.current ||
          requestContext !== selectorContextRef.current.selection
        ) {
          return
        }

        if (data.cloudId) {
          logger.info('Using cloud ID:', data.cloudId)
          setCloudBinding({ id: data.cloudId, owner: requestCloudContext })
        }

        if (data.issue) {
          logger.info('Successfully fetched issue:', data.issue.name)
          setSelectedIssue({ context: requestContext, info: data.issue })
        } else {
          logger.warn('No issue data received in response')
          setSelectedIssue({ context: requestContext, info: null })
        }
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Error fetching issue info:', error)
          if (
            mountedRef.current &&
            requestGeneration === selectionRequestRef.current &&
            feedbackGeneration === feedbackRequestRef.current &&
            requestContext === selectorContextRef.current.selection
          ) {
            setErrorKey('failedToFetchIssueInfo')
            setSelectedIssue({ context: requestContext, info: null })
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

  const fetchIssues = useCallback(
    async (searchQuery?: string, requestIntent?: number) => {
      if (!credentialId || !domain) return
      const searchIntent = requestIntent ?? ++searchIntentRef.current
      if (searchIntent !== searchIntentRef.current) return

      issuesAbortRef.current?.abort()
      const controller = new AbortController()
      issuesAbortRef.current = controller
      const requestGeneration = ++issuesRequestRef.current
      const feedbackGeneration = ++feedbackRequestRef.current
      const requestContext = selectorContextRef.current.list
      const requestCloudContext = selectorContextRef.current.cloud
      const ownsRequest = () =>
        mountedRef.current &&
        requestGeneration === issuesRequestRef.current &&
        searchIntent === searchIntentRef.current &&
        requestContext === selectorContextRef.current.list

      // If no search query is provided, require a projectId before fetching
      if (!searchQuery && !projectId) {
        if (ownsRequest()) setIssues([])
        return
      }

      if (!normalizedDomain.includes('.')) {
        if (ownsRequest()) setIssues([])
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
          ...(projectId && { projectId }),
          ...(searchQuery && { query: searchQuery }),
          ...(activeCloudId && { cloudId: activeCloudId }),
        })

        const response = await fetch(`/api/tools/jira/issues?${queryParams.toString()}`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Jira API error:', errorData)
          throw new Error('failedToFetchIssues')
        }

        const data = await response.json()
        if (!ownsRequest()) return

        if (data.cloudId) {
          setCloudBinding({ id: data.cloudId, owner: requestCloudContext })
        }

        let foundIssues: JiraIssueInfo[] = []

        if (data.sections) {
          data.sections.forEach((section: any) => {
            if (section.issues && section.issues.length > 0) {
              const sectionIssues = section.issues.map((issue: any) => ({
                id: issue.key,
                name: issue.summary || issue.summaryText || issue.key,
                mimeType: 'jira/issue',
                url: `https://${domain}/browse/${issue.key}`,
                webViewLink: `https://${domain}/browse/${issue.key}`,
              }))
              foundIssues = [...foundIssues, ...sectionIssues]
            }
          })
        }

        logger.info(`Received ${foundIssues.length} issues from API`)
        setIssues(foundIssues)
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Error fetching issues:', error)
          if (ownsRequest() && feedbackGeneration === feedbackRequestRef.current) {
            setErrorKey('failedToFetchIssues')
          }
          if (ownsRequest()) setIssues([])
        }
      } finally {
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1))
        }
      }
    },
    [credentialId, domain, normalizedDomain, activeCloudId, projectId, workflowId, workspaceId]
  )

  const handleOpenChange = (isOpen: boolean) => {
    if (disabled || isForeignCredential) {
      setOpen(false)
      return
    }
    setOpen((prev) => (prev === isOpen ? prev : isOpen))

    if (isOpen && credentialId && domain && domain.includes('.')) {
      if (projectId) {
        const searchIntent = ++searchIntentRef.current
        void fetchIssues('', searchIntent)
      }
    }
  }

  useEffect(() => {
    if (previousSelectionContextRef.current === selectionContext) return
    previousSelectionContextRef.current = selectionContext
    if (activeIssue) return
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setSelectedIssue(null)
    setErrorKey(null)
  }, [selectionContext, activeIssue])

  useEffect(() => {
    if (value && credentialId && domain && domain.includes('.') && !activeIssue) {
      void fetchIssueInfo(value)
    }
  }, [value, credentialId, activeIssue, domain, fetchIssueInfo])

  const handleSelectIssue = (issue: JiraIssueInfo) => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setErrorKey(null)
    setSelectedIssue({
      context: JSON.stringify([cloudContext, issue.id, isForeignCredential]),
      info: issue,
    })
    onChange(issue.id, issue)
    setOpen(false)
  }

  const handleClearSelection = () => {
    selectionRequestRef.current += 1
    feedbackRequestRef.current += 1
    selectionAbortRef.current?.abort()
    setSelectedIssue({ context: selectionContext, info: null })
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
            {activeIssue ? (
              <>
                <JiraIcon className='h-4 w-4' />
                <span className='truncate font-normal'>{activeIssue.name}</span>
              </>
            ) : (
              <>
                <JiraIcon className='h-4 w-4' />
                <span className='truncate text-muted-foreground'>{labelText}</span>
              </>
            )}
          </div>
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </PopoverTrigger>
        {!isForeignCredential && (
          <PopoverContent className='w-[300px] p-0' align='start'>
            <Command>
              <CommandInput placeholder={copy.searchIssues} onValueChange={handleSearch} />
              <CommandList>
                <CommandEmpty>
                  {!isLoading && !errorMessage ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>
                        {formatTemplate(copy.noItemsFound, {
                          itemName: copy.issues.toLowerCase(),
                        })}
                      </p>
                    </div>
                  ) : null}
                </CommandEmpty>

                {issues.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      {copy.issues}
                    </div>
                    {issues.map((issue) => (
                      <CommandItem
                        key={issue.id}
                        value={`issue-${issue.id}-${issue.name}`}
                        onSelect={() => handleSelectIssue(issue)}
                      >
                        <div className='flex items-center gap-1 overflow-hidden'>
                          <JiraIcon className='h-4 w-4' />
                          <span className='truncate font-normal'>{issue.name}</span>
                        </div>
                        {issue.id === value && <Check className='ml-auto h-4 w-4' />}
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
          {copy.loadingIssues}
        </p>
      ) : announcedError ? (
        <p id={feedbackId} role='alert' aria-atomic='true' className='text-destructive text-xs'>
          {announcedError}
        </p>
      ) : null}

      {showPreview && activeIssue && (
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
              <JiraIcon className='h-4 w-4' />
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <div className='flex items-center gap-1'>
                <h4 className='truncate font-medium text-xs'>{activeIssue.name}</h4>
                {activeIssue.modifiedTime && (
                  <span className='whitespace-nowrap text-muted-foreground text-xs'>
                    {new Date(activeIssue.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              {activeIssue.webViewLink ? (
                <a
                  href={activeIssue.webViewLink}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-1 text-foreground text-xs hover:underline'
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{copy.openInJira}</span>
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
