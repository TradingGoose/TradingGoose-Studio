/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminBillingTierDetail } from './tier-detail'

const mockPush = vi.fn()
const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'zh-CN'),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; href: string }) => {
    const locale = useLocaleMock()
    const localePrefix = locale === 'zh-CN' ? '/zh' : `/${locale}`
    const localizedHref =
      !href.startsWith('/') || href.startsWith(localePrefix) || locale === 'en'
        ? href
        : `${localePrefix}${href}`

    return (
      <a href={localizedHref} {...props}>
        {children}
      </a>
    )
  },
  useRouter: () => ({
    push: (href: string) => {
      const locale = useLocaleMock()
      const localePrefix = locale === 'zh-CN' ? '/zh' : `/${locale}`
      const localizedHref =
        !href.startsWith('/') || href.startsWith(localePrefix) || locale === 'en'
          ? href
          : `${localePrefix}${href}`
      mockPush(localizedHref)
    },
  }),
}))

vi.mock('@/components/ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('./tier-editor', () => ({
  BillingBreadcrumbs: () => <div data-testid='breadcrumbs' />,
  buildTierMutationInput: vi.fn(),
  createTierFormDefaults: vi.fn(),
  createTierPreviewState: vi.fn(),
  DEFAULT_TIER_EDITOR_SECTIONS: {
    general: true,
    pricing: true,
    access: true,
    seats: false,
    limits: true,
    metering: false,
  },
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Something went wrong',
  normalizeTierFormDefaults: vi.fn((value: unknown) => value),
  TierEditorFormSurface: () => null,
  TierEditorHeaderCenter: () => null,
}))

vi.mock('@/hooks/queries/admin-billing', () => ({
  useAdminBillingSnapshot: () => ({
    data: {
      currentTiers: [],
    },
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteAdminBillingTier: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateAdminBillingTier: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/app/admin/page-shell', () => ({
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/knowledge/components', () => ({
  EmptyStateCard: ({
    buttonText,
    onClick,
  }: {
    buttonText: string
    onClick: () => void
  }) => <button onClick={onClick}>{buttonText}</button>,
  PrimaryButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

describe('AdminBillingTierDetail', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPush.mockReset()
    useLocaleMock.mockReturnValue('zh-CN')
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('localizes the back button route', () => {
    act(() => {
      root.render(<AdminBillingTierDetail tierId='missing-tier' />)
    })

    const button = container.querySelector('button')
    expect(button?.textContent).toContain('Back to Billing')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockPush).toHaveBeenCalledWith('/zh/admin/billing')
  })
})
