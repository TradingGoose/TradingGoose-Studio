import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetSessionCookie,
  mockHeaders,
  mockCreateConnectionLoginApprovalChallenge,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCreateConnectionLoginApprovalChallenge: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetSessionCookie: vi.fn(),
  mockHeaders: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('better-auth/cookies', () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/connect/auth', () => ({
  createConnectionLoginApprovalChallenge: (...args: unknown[]) =>
    mockCreateConnectionLoginApprovalChallenge(...args),
}))

vi.mock('@/app/(auth)/components/auth-page-header', () => ({
  AuthPageHeader: ({
    description,
    eyebrow,
    title,
  }: {
    description: string
    eyebrow: string
    title: string
  }) => (
    <header>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: 'inter' },
}))

vi.mock('@/i18n/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}))

describe('MCP authorize page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockHeaders.mockResolvedValue(new Headers())
    mockGetSessionCookie.mockReturnValue(null)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateConnectionLoginApprovalChallenge.mockResolvedValue({
      status: 'pending',
      approvalToken: 'approval-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
  })

  it('renders a confirmation form with a user-bound approval challenge', async () => {
    const McpAuthorizePage = (await import('./page')).default

    const result = await McpAuthorizePage({
      params: Promise.resolve({ locale: 'es' }),
      searchParams: Promise.resolve({ code: 'login-code' }),
    })
    const markup = renderToStaticMarkup(result)

    expect(mockCreateConnectionLoginApprovalChallenge).toHaveBeenCalledWith({
      code: 'login-code',
      userId: 'user-1',
    })
    expect(markup).toContain('Aprobar clave API personal')
    expect(markup).toContain('method="post"')
    expect(markup).toContain('action="/api/auth/connect/authorize"')
    expect(markup).toContain('name="approvalToken"')
    expect(markup).toContain('value="approval-token"')
  })
})
