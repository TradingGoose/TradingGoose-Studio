/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockFetch = vi.fn()
const mockLocalizeHref = vi.fn((locale: string, href: string) =>
  locale === 'es' ? `/es${href}` : href
)
const mockSearchParamsValues = {
  error: null as string | null,
  new: null as string | null,
  token: 'workspace-token' as string | null,
}
const mockSearchParams = {
  get: (key: string) => mockSearchParamsValues[key as keyof typeof mockSearchParamsValues] ?? null,
}
const mockSession = {
  data: {
    user: {
      id: 'user-1',
    },
  },
  isPending: false,
}
const mockInvitationResponse = {
  ok: true,
  json: vi.fn(async () => ({
    workspaceName: 'Signals',
  })),
}
let mockLocale = 'es'
let mockInviteId = 'invitation-1'
let lastStatusCardProps:
  | {
      type?: string
      actions?: Array<{
        label: string
        onClick: () => void | Promise<void>
      }>
    }
  | null = null

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock('next-intl', () => ({
  useLocale: () => mockLocale,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockInviteId }),
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    organization: {
      getFullOrganization: vi.fn(),
      getInvitation: vi.fn(),
      setActive: vi.fn(),
    },
  },
  useSession: () => mockSession,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/app/invite/components', () => ({
  InviteLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='invite-layout'>{children}</div>
  ),
  InviteStatusCard: (props: typeof lastStatusCardProps) => {
    lastStatusCardProps = props
    return <div data-testid='invite-status-card'>{props?.type}</div>
  },
}))

vi.mock('@/i18n/client-messages', () => ({
  formatTemplate: (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ''),
  useAppMessages: () => ({
    auth: {
      common: {
        returnHome: 'Return home',
      },
    },
    invite: {
      defaultOrganizationName: 'Organization',
      defaultWorkspaceName: 'Workspace',
      errors: {
        unknown: 'Unknown error',
      },
      error: {
        title: 'Invite error',
      },
      invitation: {
        accept: 'Accept',
        description: 'Join {name}',
        organizationTitle: 'Join organization',
        workspaceTitle: 'Join workspace',
      },
      loadingDescription: 'Loading invitation details',
      loadingTitle: 'Loading invitation',
      login: {
        createAccount: 'Create account',
        existingUserDescription: 'Sign in to continue',
        iAlreadyHaveAccount: 'I already have an account',
        newUserDescription: 'Create an account to continue',
        signIn: 'Sign in',
        title: 'Sign in required',
      },
      success: {
        description: 'Joined {name}',
        title: 'Invitation accepted',
      },
      warning: {
        currentOrg: 'Already in an organization',
        currentOrgWithName: 'Already in {name}',
        manageTeamSettings: 'Manage team settings',
        title: 'Organization conflict',
      },
    },
  }),
}))

vi.mock('@/i18n/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/utils')>()

  return {
    ...actual,
    localizeHref: mockLocalizeHref,
  }
})

describe('Invite page workspace acceptance', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockLocale = 'es'
    mockInviteId = 'invitation-1'
    mockSearchParamsValues.error = null
    mockSearchParamsValues.new = null
    mockSearchParamsValues.token = 'workspace-token'
    lastStatusCardProps = null
    sessionStorage.clear()
    window.history.replaceState({}, '', 'http://localhost:3000/es/invite/invitation-1?token=workspace-token')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockResolvedValue(mockInvitationResponse)
    vi.stubGlobal('fetch', mockFetch)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount()
      })
    }
    container?.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('navigates through the localized workspace invitation API path for non-default locales', async () => {
    const Invite = (await import('./invite')).default

    await act(async () => {
      root.render(<Invite />)
      await flush()
      await flush()
      await flush()
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/invitations/invitation-1', {
      method: 'GET',
    })
    expect(lastStatusCardProps?.type).toBe('invitation')

    const acceptAction = lastStatusCardProps?.actions?.[0]

    expect(acceptAction).toBeDefined()

    await act(async () => {
      await acceptAction?.onClick()
    })

    expect(mockLocalizeHref).toHaveBeenCalledWith(
      'es',
      '/api/workspaces/invitations/invitation-1?token=workspace-token'
    )
  })
})
