/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
import { getGeneralSettingsResponsePatch } from '@/hooks/queries/general-settings'
import { organizationKeys } from '@/hooks/queries/organization'
import { getClientMessages, getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { AccountSettings } from './account-settings'

const mockUseSession = vi.fn()
const mockRefetch = vi.fn()
const auth = vi.hoisted(() => ({
  isUsernameAvailable: vi.fn(),
  updateUser: vi.fn(),
  emailOtp: { requestEmailChange: vi.fn(), changeEmail: vi.fn() },
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
let queryClient: QueryClient
const mockSetTelemetryEnabled = vi.fn()
const generalState = {
  isLoading: false,
  telemetryEnabled: false,
  isTelemetryLoading: false,
  setTelemetryEnabled: mockSetTelemetryEnabled,
}
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    <img alt={alt ?? ''} {...props} />
  ),
}))

vi.mock('@vercel/blob/client', () => ({
  upload: vi.fn(),
}))
vi.mock('@/components/icons/icons', () => ({
  AgentIcon: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
}))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/auth-client', () => ({
  client: auth,
  useSession: () => mockUseSession(),
}))
vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: typeof generalState) => unknown) => selector(generalState),
}))

function renderAccountSettings(root: Root, locale: LocaleCode) {
  root.render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={getClientMessages(locale, 'workspace')}>
        <AccountSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
function findButtonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text)
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button with text "${text}"`)
  }
  return button
}
async function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

function createSizedFile(name: string, type: string, size: number) {
  const file = new File(['avatar'], name, { type })
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: size,
  })
  return file
}
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
describe('AccountSettings localization', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    vi.clearAllMocks()
    mockSetTelemetryEnabled.mockReset()
    mockUseSession.mockReturnValue({
      refetch: mockRefetch,
      data: {
        user: {
          id: 'user-1',
          username: 'ada',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          image: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })

    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/users/me/profile' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            user: {
              name: 'Ada Lovelace',
              email: 'ada@example.com',
              image: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        } as Response
      }
      if (url === '/api/auth/forget-password') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })
  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })
  it('renders translated account labels and telemetry copy in es', async () => {
    const copy = getPublicCopy('es').workspace.settingsModal.account
    await act(async () => {
      renderAccountSettings(root, 'es')
      await flush()
    })
    expect(container.textContent).toContain(copy.profilePicture)
    expect(container.textContent).toContain(copy.profileDetails)
    expect(container.textContent).toContain(copy.profileDetailsDescription)
    expect(container.textContent).toContain(copy.passwordReset)
    expect(container.textContent).toContain(copy.telemetry.label)
    expect(container.textContent).toContain(copy.telemetry.tooltipBody)
    expect(container.textContent).toContain(copy.telemetry.body)
  })

  async function submitField(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector)!
    await act(async () => {
      setInputValue(input, value)
      input.form!.requestSubmit()
      await flush()
    })
  }

  it('keeps the display name independent and handles a username claimed before or after the check', async () => {
    const copy = getPublicCopy('en').workspace.settingsModal.account.username
    await act(async () => {
      renderAccountSettings(root, 'en')
      await flush()
    })
    auth.isUsernameAvailable.mockResolvedValueOnce({ data: { available: false } })
    await submitField('#username', 'TAKEN')
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(container.querySelector('#username-error')).toHaveTextContent(copy.taken)
    auth.isUsernameAvailable.mockResolvedValue({ data: { available: true } })
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'USERNAME_IS_ALREADY_TAKEN' } })
    await submitField('#username', 'Claimed')
    expect(container.querySelector('#username-error')).toHaveTextContent(copy.taken)
    expect(mockRefetch).not.toHaveBeenCalled()
    auth.updateUser.mockResolvedValueOnce({ data: {} })
    await submitField('#username', 'AdaTwo')
    expect(auth.isUsernameAvailable).toHaveBeenLastCalledWith({ username: 'AdaTwo' })
    expect(auth.updateUser).toHaveBeenLastCalledWith({ username: 'AdaTwo' })
    expect(mockRefetch).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Ada Lovelace')
  })

  it('refreshes the session and active organization members only after the proposed email is confirmed', async () => {
    const oldEmail = 'ada@example.com'
    const newEmail = 'ada@new.example'
    const organization = (email: string) => ({
      id: 'org',
      name: 'Organization',
      slug: 'org',
      createdAt: new Date(),
      members: [{ id: 'membership', role: 'owner', user: { id: 'user-1', email } }],
    })
    const queryKey = organizationKeys.detail('org')
    queryClient.setQueryData(queryKey, organization(oldEmail))
    const loadMembers = vi.fn(async () => organization(newEmail))
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: loadMembers })
    const unsubscribe = observer.subscribe(() => {})
    mockRefetch.mockImplementationOnce(() => {
      mockUseSession.mockReturnValue({
        data: { user: { id: 'user-1', email: newEmail } },
        refetch: mockRefetch,
      })
    })
    auth.emailOtp.requestEmailChange.mockResolvedValue({})
    auth.emailOtp.changeEmail
      .mockResolvedValueOnce({ error: { message: 'Invalid code' } })
      .mockResolvedValueOnce({})
    try {
      await act(async () => {
        renderAccountSettings(root, 'en')
        await flush()
      })
      await submitField('#new-email', newEmail)
      expect(auth.emailOtp.requestEmailChange).toHaveBeenCalledWith({ newEmail })
      await submitField('#email-change-code', '000000')
      expect(container.textContent).toContain(oldEmail)
      expect(container.textContent).toContain('Invalid code')
      expect(loadMembers).not.toHaveBeenCalled()
      expect(mockRefetch).not.toHaveBeenCalled()
      await submitField('#email-change-code', '123456')
      expect(auth.emailOtp.changeEmail).toHaveBeenLastCalledWith({ newEmail, otp: '123456' })
      expect(mockRefetch).toHaveBeenCalledOnce()
      expect(loadMembers).toHaveBeenCalledOnce()
      const email = mockUseSession().data.user.email
      expect(email).toBe(newEmail)
      expect(container.textContent).toContain(newEmail)
      const role = getUserRole(observer.getCurrentResult().data, email)
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

  it('synchronizes each settings response around independent active mutations', async () => {
    const settings = {
      theme: 'light' as const,
      preferredLocale: 'en' as const,
      telemetryEnabled: false,
      billingUsageNotificationsEnabled: true,
    }
    expect(
      getGeneralSettingsResponsePatch(settings, {
        isThemeLoading: false,
        isTelemetryLoading: false,
      })
    ).toMatchObject({ theme: 'light', telemetryEnabled: false })
    expect(
      getGeneralSettingsResponsePatch(settings, {
        isThemeLoading: true,
        isTelemetryLoading: false,
      })
    ).toEqual({
      telemetryEnabled: false,
      isBillingUsageNotificationsEnabled: true,
    })
    expect(
      getGeneralSettingsResponsePatch(settings, {
        isThemeLoading: false,
        isTelemetryLoading: true,
      })
    ).toEqual({
      theme: 'light',
      isBillingUsageNotificationsEnabled: true,
    })
  })
  it('localizes name validation, profile image validation, and password reset status in zh', async () => {
    const copy = getPublicCopy('zh').workspace.settingsModal.account
    await act(async () => {
      renderAccountSettings(root, 'zh')
      await flush()
    })
    await act(async () => {
      await click(findButtonByText(container, copy.editName))
    })
    const nameInput = container.querySelector('#accountName')
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error('Expected editable name input to render')
    }

    await act(async () => {
      setInputValue(nameInput, '   ')
      await flush()
    })
    await act(async () => {
      await click(findButtonByText(container, copy.saveName))
    })
    expect(container.textContent).toContain(copy.status.nameRequiredValidation)
    const fileInput = container.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Expected profile picture input to render')
    }
    const oversizedFile = createSizedFile('avatar.png', 'image/png', 6 * 1024 * 1024)

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [oversizedFile],
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
    expect(container.textContent).toContain(
      formatTemplate(copy.status.profilePictureFileTooLarge, { name: oversizedFile.name })
    )
    await act(async () => {
      await click(findButtonByText(container, copy.sendLink))
    })
    expect(container.textContent).toContain(copy.status.passwordResetSent)
  })
})
