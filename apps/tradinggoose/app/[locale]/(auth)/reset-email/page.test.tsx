/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
import { PostHogProvider } from '@/lib/posthog/provider'
import { organizationKeys } from '@/hooks/queries/organization'
import { getClientMessages, getPublicCopy } from '@/i18n/public-copy'
import ResetEmailPage from './page'

const auth = vi.hoisted(() => ({
  request: vi.fn(),
  confirm: vi.fn(),
  sendLink: vi.fn(),
  getSession: vi.fn(),
  sendVerificationOtp: vi.fn(),
  refetch: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
  user: { id: 'owner', email: 'old@example.com' } as { id: string; email: string } | null,
}))
const initAnalytics = vi.hoisted(() => vi.fn())
vi.mock('posthog-js', () => ({ default: { init: initAnalytics } }))
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: auth.user }, isPending: false, refetch: auth.refetch }),
  client: {
    getSession: auth.getSession,
    emailOtp: {
      requestEmailChange: auth.request,
      changeEmail: auth.confirm,
      sendVerificationOtp: auth.sendVerificationOtp,
    },
  },
  requestEmailChangeLink: auth.sendLink,
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => auth.router,
  Link: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/app/fonts/inter', () => ({ inter: { className: '' } }))
vi.mock('@/app/fonts/soehne/soehne', () => ({ soehne: { className: '' } }))

const path = '/es/reset-email'
const ownerLink = `${path}#accountId=owner&otp=654321`
const newEmail = 'new@example.com'
const copy = getPublicCopy('es').auth.resetEmail
let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider messages={getClientMessages('es')} locale='es'>
          <ResetEmailPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  })
}

async function submit(value: string) {
  const input = container.querySelector('input')!
  input.value = value
  await act(async () => input.form!.requestSubmit())
}

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === text
  )!
  await act(async () => button.click())
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  auth.user = { id: 'owner', email: 'old@example.com' }
  const storage = new Map<string, string>()
  vi.mocked(sessionStorage.getItem).mockImplementation((key) => storage.get(key) ?? null)
  vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => {
    storage.set(key, value)
  })
  vi.mocked(sessionStorage.removeItem).mockImplementation((key) => {
    storage.delete(key)
  })
  window.history.replaceState(null, '', ownerLink)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('localized account email change', () => {
  it('defers analytics if the page is still hydrating with a private link fragment', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'local-fixture')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_DISABLED', '0')
    await act(async () => root.render(<PostHogProvider>{null}</PostHogProvider>))
    expect(initAnalytics).not.toHaveBeenCalled()
    window.history.replaceState(null, '', '/es/login?callbackUrl=%2Freset-email')
    await act(async () => root.render(<PostHogProvider>{null}</PostHogProvider>))
    expect(initAnalytics).toHaveBeenCalledOnce()
  })

  it.each(['', '#otp=654321', '#accountId=owner&otp=no-code'])(
    'rejects an incomplete link (%s)',
    async (fragment) => {
      window.history.replaceState(null, '', path + fragment)
      await render()
      expect(container.querySelector('[role="alert"]')).toHaveTextContent(copy.invalidLink)
      expect(container.querySelector('form')).toBeNull()
      expect(auth.request).not.toHaveBeenCalled()
      expect(auth.confirm).not.toHaveBeenCalled()
      expect(auth.sendLink).not.toHaveBeenCalled()
    }
  )

  it('resumes a signed-out visit through the fixed same-origin login callback, including switching accounts', async () => {
    auth.user = null
    window.history.replaceState(
      null,
      '',
      `${path}?callbackUrl=https://outside.example#accountId=owner&otp=654321`
    )
    await render()
    expect(auth.router.replace).toHaveBeenCalledWith('/login?callbackUrl=%2Freset-email')
    expect(location.href).toBe(location.origin + path)
    expect(container.textContent).not.toContain('654321')
    act(() => root.unmount())
    root = createRoot(container)
    auth.user = { id: 'other', email: 'other@example.com' }
    await render()
    expect(container.textContent).toContain(copy.wrongAccount)
    expect(container.querySelector('input')).toBeNull()
    await click(copy.switchAccount)
    expect(auth.router.push).toHaveBeenCalledWith('/login?callbackUrl=%2Freset-email&reauth=1')
    act(() => root.unmount())
    root = createRoot(container)
    auth.user = { id: 'owner', email: 'old@example.com' }
    await render()
    expect(container.querySelector('input[type=email]')).toBeTruthy()
    expect(sessionStorage.getItem('reset-email-login-link')).toBeNull()
    expect(auth.request).not.toHaveBeenCalled()
    expect(auth.sendLink).not.toHaveBeenCalled()
    expect(auth.confirm).not.toHaveBeenCalled()
  })

  it('preserves ownership and refreshes active member data only after the target code is accepted', async () => {
    const organization = (email: string) => ({
      id: 'org',
      name: 'Org',
      slug: 'org',
      createdAt: new Date(),
      members: [{ id: 'membership', role: 'owner', user: { id: 'owner', email } }],
    })
    const queryKey = organizationKeys.detail('org')
    queryClient.setQueryData(queryKey, organization(auth.user!.email))
    const loadMembers = vi.fn(async () => organization(newEmail))
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: loadMembers })
    const unsubscribe = observer.subscribe(() => {})
    auth.refetch.mockImplementation(() => {
      auth.user = { id: 'owner', email: newEmail }
    })
    auth.request.mockResolvedValue({})
    auth.confirm.mockResolvedValueOnce({ error: { code: 'INVALID_OTP' } }).mockResolvedValueOnce({})
    try {
      await render()
      expect(location.hash).toBe('')
      expect(auth.request).not.toHaveBeenCalled()
      await submit(newEmail.toUpperCase())
      expect(auth.request).toHaveBeenCalledExactlyOnceWith({ newEmail, otp: '654321' })
      expect(container.querySelector('input[type=email]')).toBeNull()
      expect(container.textContent).toContain('15 minutos')
      await submit('000000')
      expect(container.querySelector('[role="alert"]')).toHaveTextContent(copy.invalidCode)
      expect(auth.refetch).not.toHaveBeenCalled()
      expect(loadMembers).not.toHaveBeenCalled()
      await submit('123456')
      expect(auth.confirm).toHaveBeenLastCalledWith({ newEmail, otp: '123456' })
      expect(auth.refetch).toHaveBeenCalledOnce()
      expect(loadMembers).toHaveBeenCalledOnce()
      expect(container.querySelector('[role="status"]')).toHaveTextContent(newEmail)
      const role = getUserRole(observer.getCurrentResult().data, auth.user!.email)
      expect(role).toBe('owner')
      expect(
        getOrganizationAccessState({
          billingEnabled: false,
          hasOrganization: true,
          isOrganizationAdmin: role === 'owner',
        })
      ).toMatchObject({ canManageOrganization: true, canConfigureSso: true })
    } finally {
      unsubscribe()
    }
  })

  it.each(['invalid link', 'expired code', 'lost code or change of target'])(
    'restarts with a link to the original account after %s',
    async (reason) => {
      auth.request.mockResolvedValue(
        reason === 'invalid link' ? { error: { code: 'INVALID_OTP' } } : {}
      )
      auth.sendLink.mockResolvedValue(null)
      await render()
      await submit(newEmail)
      if (reason === 'expired code') {
        auth.confirm.mockResolvedValue({ error: { code: 'OTP_EXPIRED' } })
        await submit('123456')
        expect(container.querySelector('[role="alert"]')).toHaveTextContent(copy.codeExpired)
      }
      if (reason === 'invalid link')
        expect(container.querySelector('[role="alert"]')).toHaveTextContent(copy.invalidLink)
      await click(copy.restart)
      expect(auth.sendLink).toHaveBeenCalledExactlyOnceWith('owner')
      expect(container.querySelector('[role="status"]')).toHaveTextContent(copy.sent)
      expect(container.querySelector('form')).toBeNull()
      expect(auth.request).toHaveBeenCalledOnce()
      expect(auth.refetch).not.toHaveBeenCalled()
    }
  )

  it('offers ordinary signup verification when restarting requires a verified current mailbox', async () => {
    const accountCopy = getPublicCopy('es').workspace.settingsModal.account
    const email = auth.user!.email
    auth.request.mockResolvedValue({ error: { code: 'INVALID_OTP' } })
    auth.sendLink.mockResolvedValue({ accountId: 'owner', email })
    await render()
    await submit(newEmail)
    await click(copy.restart)
    expect(container).toHaveTextContent(email)
    expect(container).not.toHaveTextContent(copy.sent)
    expect(auth.sendVerificationOtp).not.toHaveBeenCalled()
    auth.getSession.mockResolvedValue({ data: { user: auth.user } })
    auth.sendVerificationOtp.mockResolvedValue({})
    await click(accountCopy.verifyEmailButton)
    expect(auth.sendVerificationOtp).toHaveBeenCalledExactlyOnceWith({
      email,
      type: 'email-verification',
    })
    expect(sessionStorage.getItem('verificationEmail')).toBe(email)
    expect(auth.router.push).toHaveBeenCalledExactlyOnceWith('/verify')
    expect(auth.sendLink).toHaveBeenCalledOnce()
    expect(auth.confirm).not.toHaveBeenCalled()
  })

  it('removes confirmation and restart controls if the session switches accounts', async () => {
    auth.request.mockResolvedValue({})
    await render()
    await submit(newEmail)
    auth.user = { id: 'other', email: 'other@example.com' }
    await render()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(copy.wrongAccount)
    expect(container.querySelector('form')).toBeNull()
    expect(container.textContent).not.toContain(copy.restart)
    expect(auth.confirm).not.toHaveBeenCalled()
    expect(auth.sendLink).not.toHaveBeenCalled()
  })
})
