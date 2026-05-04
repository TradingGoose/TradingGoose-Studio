import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GlobalNavbar } from './global-navbar'

const { useLocaleMock, usePathnameMock, useSessionMock, useWorkspaceSwitcherMock } =
  vi.hoisted(() => ({
    useLocaleMock: vi.fn(() => 'zh-CN'),
    usePathnameMock: vi.fn(() => '/zh/workspace/ws-1/dashboard'),
    useSessionMock: vi.fn(() => ({
      data: {
        user: {
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          image: null,
          updatedAt: null,
        },
      },
      isPending: false,
    })),
    useWorkspaceSwitcherMock: vi.fn(() => ({
      activeWorkspace: {
        id: 'ws-1',
        name: 'Workspace One',
      },
      workspaces: [],
      isWorkspacesLoading: false,
      canManageWorkspaces: false,
      workspaceMenuOpen: false,
      setWorkspaceMenuOpen: vi.fn(),
      hoveredWorkspaceId: null,
      setHoveredWorkspaceId: vi.fn(),
      editingWorkspaceId: null,
      editingWorkspaceName: '',
      setEditingWorkspaceName: vi.fn(),
      isRenamingWorkspace: false,
      renameError: null,
      handleStartEditing: vi.fn(),
      handleCancelEditing: vi.fn(),
      handleSaveWorkspaceName: vi.fn(),
      handleSwitchWorkspace: vi.fn(),
      handleCreateWorkspace: vi.fn(),
      inviteDialogOpen: false,
      handleInviteDialogChange: vi.fn(),
      inviteWorkspace: null,
      handleOpenInviteDialog: vi.fn(),
      deleteDialogOpen: false,
      handleDeleteDialogChange: vi.fn(),
      workspaceToDelete: null,
      setWorkspaceToDelete: vi.fn(),
      deleteError: null,
      isDeletingWorkspace: false,
      handleConfirmDelete: vi.fn(),
    })),
  }))

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: useSessionMock,
}))

vi.mock('@/lib/branding/branding', () => ({
  getBrandConfig: () => ({
    name: 'TradingGoose',
    faviconUrl: '/favicon.ico',
    supportEmail: 'support@tradinggoose.ai',
  }),
}))

vi.mock('@/lib/environment', () => ({
  isHosted: false,
}))

vi.mock('@/lib/organization/access', () => ({
  getOrganizationAccessState: () => ({
    canOpenTeamSettings: true,
  }),
}))

vi.mock('@/lib/organization/helpers', () => ({
  getUserRole: () => 'owner',
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useSubscriptionData: () => ({
    data: {
      billingEnabled: true,
      billingBlocked: false,
      tier: { ownerType: 'user', displayName: 'Pro' },
    },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizations: () => ({
    data: {
      activeOrganization: {
        id: 'org-1',
        ownerId: 'user-1',
      },
      billingData: { data: { billingEnabled: true } },
    },
  }),
  useOrganizationBilling: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('./components/navbar-header', () => ({
  NavbarHeader: ({ pageTitle }: { pageTitle?: string }) =>
    createElement('div', { 'data-testid': 'navbar-header', 'data-page-title': pageTitle ?? '' }),
}))

vi.mock('./components/workspace-switcher', () => ({
  WorkspaceSwitcher: () => createElement('div', { 'data-testid': 'workspace-switcher' }),
}))

vi.mock('./components/sidebar-nav', () => ({
  SidebarNav: ({ navItems }: { navItems: Array<{ title: string; isActive?: boolean; url: string }> }) =>
    createElement(
      'nav',
      { 'data-testid': 'sidebar-nav' },
      navItems.map((item) =>
        createElement(
          'div',
          {
            key: item.url,
            'data-testid': `nav-${item.title}`,
            'data-active': item.isActive ? 'true' : 'false',
            'data-url': item.url,
          },
          item.title
        )
      )
    ),
  SidebarUsageIndicator: () => null,
}))

vi.mock('./components/user-menu', () => ({
  UserMenu: () => createElement('div', { 'data-testid': 'user-menu' }),
}))

vi.mock('./components/workspace-dialogs', () => ({
  WorkspaceDialogs: () => null,
}))

vi.mock('./settings-modal/settings-dialog', () => ({
  SettingsDialog: () => null,
}))

vi.mock('./header-context', () => ({
  GlobalNavbarHeaderProvider: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: ReactNode }) => createElement('div', { 'data-testid': 'sidebar' }, children),
  SidebarContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'sidebar-content' }, children),
  SidebarFooter: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'sidebar-footer' }, children),
  SidebarHeader: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'sidebar-header' }, children),
  SidebarInset: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'sidebar-inset' }, children),
  SidebarProvider: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'sidebar-provider' }, children),
  SidebarRail: () => null,
}))

vi.mock('./use-workspace-switcher', () => ({
  useWorkspaceSwitcher: useWorkspaceSwitcherMock,
}))

describe('GlobalNavbar', () => {
  it('renders the workspace sidebar on locale-prefixed workspace routes', () => {
    useLocaleMock.mockReturnValue('zh-CN')
    usePathnameMock.mockReturnValue('/zh/workspace/ws-1/dashboard')

    const markup = renderToStaticMarkup(
      createElement(
        GlobalNavbar,
        {
          navigationMode: 'workspace',
          isSystemAdmin: false,
          children: createElement('div', { 'data-testid': 'content' }),
        }
      )
    )

    expect(markup).toContain('data-testid="sidebar-nav"')
    expect(markup).toContain('data-active="true"')
    expect(markup).toContain('data-url="/workspace/ws-1/dashboard"')
    expect(markup).toContain('data-testid="content"')
  })
})
