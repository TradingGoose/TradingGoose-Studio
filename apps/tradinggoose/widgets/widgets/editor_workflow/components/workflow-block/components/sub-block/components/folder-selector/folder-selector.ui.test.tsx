/** @vitest-environment jsdom */

import type { ButtonHTMLAttributes, ComponentProps, ReactElement, ReactNode } from 'react'
import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfluenceFileSelector } from '../file-selector/components/confluence-file-selector'
import { JiraIssueSelector } from '../file-selector/components/jira-issue-selector'
import { JiraProjectSelector } from '../project-selector/components/jira-project-selector'
import { FolderSelector } from './folder-selector'

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useLocale: () => 'en',
  useMessages: () => ({
    workspace: {
      widgets: {
        workflowLabels: {
          connectProviderAccount: 'Connect {providerName} account',
          connectProviderAccountToContinue: 'Connect a {providerName} account to continue.',
          failedToLoadItems: 'Could not load {itemName}. Try again.',
          folders: 'Folders',
          labels: 'Labels',
          loadingItems: 'Loading {itemName}...',
          noAccountsConnected: 'No accounts connected.',
          noItemsFound: 'No {itemName} found.',
          reconnectProviderAccount: 'Reconnect your {providerName} account to load {itemName}.',
          searchItems: 'Search {itemName}...',
          selectFolder: 'Select folder',
          switchAccount: 'Switch account',
          tryAgain: 'Try again',
          tryDifferentSearchOrAccount: 'Try a different search or account.',
          unknown: 'Unknown',
          selectJiraIssue: 'Select Jira issue',
          loadingIssues: 'Loading issues',
          issues: 'Issues',
          pages: 'Pages',
          searchIssues: 'Search issues',
          selectConfluencePage: 'Select Confluence page',
        },
        blockEditor: {
          jiraIssueSelector: {
            errors: {
              failedToFetchIssueInfo: 'Failed to fetch issue details',
              failedToFetchIssues: 'Failed to fetch issues',
              invalidDomainFormat: 'Invalid domain',
            },
          },
          jiraProjectSelector: {
            errors: {
              failedToFetchProjectDetails: 'Failed to fetch project details',
              failedToFetchProjects: 'Failed to fetch projects',
              invalidDomainFormat: 'Invalid domain',
            },
          },
          confluenceFileSelector: {
            errors: {
              failedToFetchPageInfo: 'Failed to fetch page details',
              failedToFetchPages: 'Failed to fetch pages',
              invalidDomainFormat: 'Invalid domain',
            },
          },
        },
      },
    },
  }),
}))
vi.mock('@/lib/oauth', () => ({
  getProviderIdFromServiceId: () => 'outlook',
  getServiceIdFromScopes: () => 'outlook',
}))
vi.mock('@/components/icons/icons', () => ({
  ConfluenceIcon: () => <span />,
  GmailIcon: () => <span />,
  JiraIcon: () => <span />,
  OutlookIcon: () => <span />,
}))
vi.mock('@/components/oauth/oauth-required-modal', () => ({
  OAuthRequiredModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid='oauth-modal'>Reconnect modal</div> : null,
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/components/ui/popover', async () => {
  const { createContext, useContext } = await import('react')
  const OpenContext = createContext<(open: boolean) => void>(() => {})
  return {
    Popover: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode
      onOpenChange?: (open: boolean) => void
    }) => (
      <OpenContext.Provider value={onOpenChange ?? (() => {})}>{children}</OpenContext.Provider>
    ),
    PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PopoverTrigger: ({
      children,
      render,
      disabled,
    }: {
      children: ReactNode
      render: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
      disabled?: boolean
    }) => {
      const onOpenChange = useContext(OpenContext)
      return cloneElement(render, { disabled, onClick: () => onOpenChange(true) }, children)
    },
  }
})
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: (props: { placeholder?: string; onValueChange?: (value: string) => void }) => (
    <input
      placeholder={props.placeholder}
      onInput={(event) => props.onValueChange?.(event.currentTarget.value)}
    />
  ),
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type='button' onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const response = (body: unknown, status = 200) => Response.json(body, { status })
const folder = (id: string, name: string) => ({ id, name, type: 'mail' })
const foldersResponse = (...folders: ReturnType<typeof folder>[]) => response({ folders })
const credentialsResponse = (id = 'credential-1') =>
  response({ credentials: [{ id, name: 'Outlook account', isDefault: true }] })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return {
    promise,
    settle: (value: T) =>
      act(async () => {
        resolve(value)
        await promise
      }),
  }
}
const requestUrl = (input: RequestInfo | URL) =>
  new URL(String(input), 'https://studio.example.test')
const requested = (mock: ReturnType<typeof vi.fn>, fragment: string) =>
  mock.mock.calls.some(([input]) => String(input).includes(fragment))

describe('Provider selector feedback', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const renderSelector = (props: Partial<ComponentProps<typeof FolderSelector>> = {}) =>
    act(async () => {
      root.render(<FolderSelector value='' provider='outlook' onChange={vi.fn()} {...props} />)
    })

  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!
  const search = (query: string) =>
    act(async () => {
      const input = container.querySelector('input') as HTMLInputElement
      input.value = query
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const expectFolderFailure = () =>
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load folders'
    )
  const verifyControlledMetadata = async (
    Selector: typeof JiraIssueSelector | typeof ConfluenceFileSelector | typeof JiraProjectSelector,
    provider: 'jira' | 'confluence',
    responseKey: 'issue' | 'file' | 'project',
    label: string
  ) => {
    const requests: ReturnType<typeof deferred<Response>>[] = []
    const onChange = vi.fn()
    const commits: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const request = deferred<Response>()
        requests.push(request)
        return request.promise.then((result) => result.clone())
      })
    )
    const base = {
      value: 'A',
      provider,
      domain: 'workspace.atlassian.net',
      credentialId: 'credential-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    }
    const renderContext = (context: typeof base) =>
      act(async () => {
        root.render(
          <div ref={(node) => void (node && commits.push(node.textContent ?? ''))}>
            <Selector {...context} onChange={onChange} />
          </div>
        )
      })
    const nextRequest = (context: object) =>
      vi.waitFor(() => {
        const request = requests.shift()
        expect(request, JSON.stringify(context)).toBeDefined()
        return request!
      })
    const metadata = (name: string) => ({ id: 'A', name, mimeType: 'text/plain' })

    await renderContext(base)
    await (await nextRequest(base)).settle(response({ [responseKey]: metadata(`${label} A`) }))
    await vi.waitFor(() => expect(container.textContent).toContain(`${label} A`))
    for (const change of [
      { value: 'B' },
      { credentialId: 'credential-2' },
      { provider: provider === 'jira' ? ('confluence' as const) : ('jira' as const) },
      { domain: 'other.atlassian.net' },
      { workflowId: 'workflow-2' },
      { workspaceId: 'workspace-2' },
    ]) {
      commits.length = 0
      await renderContext({ ...base, ...change })
      expect(commits[0]).not.toContain(`${label} A`)
      const staleRequest = await nextRequest(change)
      await renderContext(base)
      const currentRequest = await nextRequest(base)
      await staleRequest.settle(response({ [responseKey]: metadata(`${label} stale`) }))
      expect(container.textContent).not.toContain(`${label} stale`)
      await currentRequest.settle(response({ [responseKey]: metadata(`${label} A`) }))
      await vi.waitFor(() => expect(container.textContent).toContain(`${label} A`))
    }
    await renderContext({ ...base, value: '' })
    expect(container.textContent).not.toContain(`${label} A`)
    expect(onChange).not.toHaveBeenCalled()
  }

  it('binds Jira issue metadata to late collaborative values', () =>
    verifyControlledMetadata(JiraIssueSelector, 'jira', 'issue', 'Issue'))

  it('binds Confluence metadata to late collaborative values', () =>
    verifyControlledMetadata(ConfluenceFileSelector, 'confluence', 'file', 'Page'))

  it('binds Jira project metadata to its complete selection context', () =>
    verifyControlledMetadata(JiraProjectSelector, 'jira', 'project', 'Project'))

  it('keeps one trigger-associated failure channel and recovers through retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(credentialsResponse())
      .mockResolvedValueOnce(response({ folders: [] }))
      .mockResolvedValueOnce(response({ error: 'private provider detail' }, 403))
      .mockResolvedValueOnce(response({ folders: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await renderSelector()
    await search('retry-query')
    const alert = await vi.waitFor(() => {
      const element = container.querySelector<HTMLElement>('[role="alert"]')
      expect(element?.textContent).toContain('Could not load folders')
      return element!
    })
    const trigger = container.querySelector<HTMLElement>('[role="combobox"]')
    expect(trigger?.getAttribute('aria-describedby')).toBe(alert.id)
    expect(alert.textContent).not.toContain('private provider detail')
    expect(container.querySelector('[data-testid="oauth-modal"]')).toBeNull()
    await act(async () => button('Try again').click())
    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.querySelector('[role="status"]')?.textContent).toContain('No folders found')
    })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('query=retry-query')
  })

  it('distinguishes reconnect-required responses and opens the existing OAuth flow', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(credentialsResponse())
      .mockResolvedValueOnce(response({ authRequired: true, details: 'private token detail' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await renderSelector()
    const reconnect = await vi.waitFor(() => {
      expect(button('Connect Outlook account')).toBeTruthy()
      return button('Connect Outlook account')
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Reconnect your Outlook account'
    )
    expect(container.textContent).not.toContain('private token detail')
    act(() => reconnect.click())
    expect(container.querySelector('[data-testid="oauth-modal"]')).not.toBeNull()
  })

  it('keeps a folder failure visible when a concurrent credential request settles later', async () => {
    const credentialRequest = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/api/auth/oauth/credentials')
        ? credentialRequest.promise
        : Promise.resolve(response({ error: 'forbidden' }, 403))
    )
    vi.stubGlobal('fetch', fetchMock)
    await renderSelector({ credentialId: 'credential-1' })
    await vi.waitFor(expectFolderFailure)
    await credentialRequest.settle(credentialsResponse('credential-2'))
    expectFolderFailure()
    await renderSelector({ credentialId: '' })
    await vi.waitFor(() => expect(requested(fetchMock, 'credentialId=credential-2')).toBe(true))
  })

  it('ignores superseded searches and invalidates a pending search when the query shortens', async () => {
    const firstSearch = deferred<Response>()
    const secondSearch = deferred<Response>()
    const shortenedSearch = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/oauth/credentials')) return Promise.resolve(credentialsResponse())
      const query = requestUrl(input).searchParams.get('query')
      if (query === 'first') return firstSearch.promise
      if (query === 'second') return secondSearch.promise
      if (query === 'shorten') return shortenedSearch.promise
      return Promise.resolve(response({ folders: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await renderSelector({ credentialId: 'credential-1' })
    await search('first')
    await search('second')
    await secondSearch.settle(foldersResponse(folder('second', 'Second')))
    await vi.waitFor(() => expect(container.textContent).toContain('Second'))
    await firstSearch.settle(response({ error: 'stale failure' }, 503))
    expect(container.querySelector('[role="alert"]')).toBeNull()

    await search('shorten')
    await search('ab')
    await shortenedSearch.settle(foldersResponse(folder('stale', 'Stale')))
    expect(container.textContent).not.toContain('Stale')
  })

  it('binds selected metadata and callbacks to the current controlled value', async () => {
    const firstDetail = deferred<Response>()
    const secondDetail = deferred<Response>()
    const onFolderInfoChange = vi.fn()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/oauth/credentials')) return Promise.resolve(credentialsResponse())
      const folderId = requestUrl(input).searchParams.get('folderId')
      if (folderId === 'first') return firstDetail.promise
      if (folderId === 'second') return secondDetail.promise
      return Promise.resolve(response({ folders: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const props = { credentialId: 'credential-1', onFolderInfoChange }
    await renderSelector({ ...props, value: 'first' })
    await vi.waitFor(() => expect(requested(fetchMock, 'folderId=first')).toBe(true))
    await renderSelector({ ...props, value: 'second' })
    await vi.waitFor(() => expect(requested(fetchMock, 'folderId=second')).toBe(true))
    const second = folder('second', 'Second folder')
    await secondDetail.settle(response({ folder: second }))
    await vi.waitFor(() => expect(container.textContent).toContain('Second folder'))
    await firstDetail.settle(response({ folder: folder('first', 'First folder') }))
    expect(container.textContent).not.toContain('First folder')
    expect(onFolderInfoChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'first' }))
    expect(onFolderInfoChange).toHaveBeenCalledWith(second)
  })

  it('retries the credential domain when no credential is usable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: 'offline' }, 503))
      .mockResolvedValueOnce(credentialsResponse())
      .mockResolvedValueOnce(response({ folders: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await renderSelector()
    await vi.waitFor(() => expect(button('Try again')).toBeTruthy())
    await act(async () => button('Try again').click())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/auth/oauth/credentials')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/tools/outlook/folders')
  })
})
