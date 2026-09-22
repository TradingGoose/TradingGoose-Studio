/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCredentialSelector } from './tool-credential-selector'

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useLocale: () => 'en',
}))
vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useWorkspaceBlockEditorMessages: () => ({
    toolInput: {
      selectProviderAccount: 'Select {provider} account',
      useInWorkflow: 'Use in this workflow',
      failedToSaveConnection: 'Could not save this connection. Try again.',
    },
  }),
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => ({ workflowId: 'workflow' }),
}))
vi.mock('@/components/oauth/oauth-required-modal', () => ({
  OAuthRequiredModal: (props: unknown) => {
    oauthModal(props)
    return null
  },
}))
vi.mock('@/hooks/queries/oauth-connections', () => ({
  useOAuthConnections: () => ({
    data: [{ providerId: 'robinhood', accounts: [{ id: 'account', name: 'Personal' }] }],
    isLoading: false,
    refetch: stableRefetch,
  }),
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div data-trigger>{children}</div>,
}))
vi.mock('@/components/ui/command', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Command: Container,
    CommandList: Container,
    CommandGroup: Container,
    CommandInput: () => <input />,
    CommandEmpty: () => null,
    CommandItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: ReactNode
      onSelect: () => void
      disabled?: boolean
    }) => (
      <button disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
  }
})

const oauthModal = vi.fn()
const stableRefetch = vi.fn()
const onChange = vi.fn()
const fetchMock = vi.fn()
const saved = {
  id: 'saved',
  name: 'Saved',
  provider: 'robinhood',
  accountId: 'saved-account',
  isOwner: true,
}
const connection = { id: 'account', name: 'Personal', provider: 'robinhood', isOwner: true }

describe('ToolCredentialSelector workspace connections', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    container = document.createElement('div')
    root = createRoot(container)
    fetchMock.mockImplementation(async (_url, options) =>
      options?.method === 'POST'
        ? Response.json({ credentialId: 'workspace-credential' })
        : Response.json({ credentials: [saved], connections: [connection] })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (credentialSource: 'workspace' | 'personal' = 'workspace') => {
    await act(async () =>
      root.render(
        <ToolCredentialSelector
          provider='robinhood'
          credentialSource={credentialSource}
          value=''
          onChange={onChange}
        />
      )
    )
  }
  const select = async (name: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((entry) =>
      entry.textContent?.includes(name)
    )!
    await act(async () => button.click())
  }

  it('saves a personal connection before selecting its workspace credential', async () => {
    await render()
    expect(container.textContent).toContain('Use in this workflow')
    await select('Personal')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/oauth/credentials',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workflowId: 'workflow', accountId: 'account' }),
      })
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith('workspace-credential')
    fetchMock.mockResolvedValueOnce(
      Response.json({
        credentials: [{ ...connection, id: 'workspace-credential' }],
        connections: [],
      })
    )
    await act(async () =>
      root.render(
        <ToolCredentialSelector
          provider='robinhood'
          value='workspace-credential'
          onChange={onChange}
        />
      )
    )
    expect(container.querySelector('[data-trigger] span')?.textContent).toBe('Personal')
  })

  it('keeps the current selection when saving fails', async () => {
    await render()
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }))
    await select('Personal')
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save')
  })

  it.each(['workspace', 'personal'] as const)(
    'selects existing %s credentials without publishing',
    async (source) => {
      await render(source)
      await select(source === 'workspace' ? 'Saved' : 'Personal')
      expect(onChange).toHaveBeenCalledExactlyOnceWith(source === 'workspace' ? 'saved' : 'account')
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    }
  )

  it.each([
    { serviceIds: ['alpaca-live', 'alpaca-paper'] },
    { requiredScopes: ['trading', 'data'] },
  ])('preserves explicit and scope-derived service choices: %o', async (services) => {
    fetchMock.mockResolvedValue(Response.json({ credentials: [], connections: [] }))
    await act(async () =>
      root.render(
        <ToolCredentialSelector provider='alpaca' value='' onChange={onChange} {...services} />
      )
    )
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/oauth/credentials?provider=alpaca-live&workflowId=workflow',
      '/api/auth/oauth/credentials?provider=alpaca-paper&workflowId=workflow',
    ])
    await select('Alpaca Paper')
    expect(oauthModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ isOpen: true, serviceId: 'alpaca-paper' })
    )
  })
})
