/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGeneralSettingsResponsePatch } from '@/hooks/queries/general-settings'
import { getClientMessages, getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { AccountSettings } from './account-settings'

const mockUseSession = vi.fn()
const mockRefetch = vi.fn()
const auth = vi.hoisted(() => ({
  isUsernameAvailable: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  emailOtp: { sendVerificationOtp: vi.fn() },
  push: vi.fn(),
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: auth.push }) }))
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
vi.mock('@/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-client')>()),
  client: auth,
  useSession: () => mockUseSession(),
}))
vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: typeof generalState) => unknown) => selector(generalState),
}))

function renderAccountSettings(root: Root, locale: LocaleCode) {
  root.render(
    <NextIntlClientProvider locale={locale} messages={getClientMessages(locale, 'workspace')}>
      <AccountSettings />
    </NextIntlClientProvider>
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
    expect(container.querySelector('label[for="displayName"]')).toHaveTextContent('Nombre visible')
    expect(container.textContent).toContain(copy.passwordReset)
    expect(container.textContent).toContain(copy.telemetry.label)
    expect(container.textContent).toContain(copy.telemetry.tooltipBody)
    expect(container.textContent).toContain(copy.telemetry.body)
  })

  it('selects the username for editing and cancels with the cancel button, Escape or blur', async () => {
    const copy = getPublicCopy('en').workspace.settingsModal.account.username
    await act(async () => renderAccountSettings(root, 'en'))
    expect(container.querySelector('#username')).toBeNull()
    for (const action of ['cancel', 'escape', 'blur'] as const) {
      await act(async () => click(findButtonByText(container, copy.edit)))
      const input = container.querySelector<HTMLInputElement>('#username')!
      expect(input).toHaveFocus()
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
      await act(async () => setInputValue(input, 'discard'))
      await act(async () => {
        if (action === 'cancel') await click(findButtonByText(container, copy.cancel))
        if (action === 'escape') {
          const dialogKeyDown = vi.fn()
          document.addEventListener('keydown', dialogKeyDown)
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          document.removeEventListener('keydown', dialogKeyDown)
          expect(dialogKeyDown).not.toHaveBeenCalled()
        }
        if (action === 'blur') input.blur()
      })
      expect(container.querySelector('#username')).toBeNull()
      expect(container.textContent).toContain('ada')
    }
    expect(auth.isUsernameAvailable).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('skips a normalized unchanged username and handles native availability and update errors', async () => {
    const copy = getPublicCopy('en').workspace.settingsModal.account.username
    await act(async () => renderAccountSettings(root, 'en'))
    await act(async () => click(findButtonByText(container, copy.edit)))
    let input = container.querySelector<HTMLInputElement>('#username')!
    await act(async () => setInputValue(input, '  ADA  '))
    await act(async () => input.form!.requestSubmit())
    expect(container.querySelector('#username')).toBeNull()
    expect(auth.isUsernameAvailable).not.toHaveBeenCalled()

    await act(async () => click(findButtonByText(container, copy.edit)))
    input = container.querySelector<HTMLInputElement>('#username')!
    auth.isUsernameAvailable.mockResolvedValueOnce({ data: { available: false } })
    await act(async () => setInputValue(input, 'TAKEN'))
    await act(async () => input.form!.requestSubmit())
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(container.querySelector('#username-error')).toHaveTextContent(copy.taken)

    auth.isUsernameAvailable.mockResolvedValueOnce({ error: { message: 'Invalid username' } })
    await act(async () => input.form!.requestSubmit())
    expect(input).toHaveAccessibleDescription('Invalid username')

    auth.isUsernameAvailable.mockResolvedValue({ data: { available: true } })
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'USERNAME_IS_ALREADY_TAKEN' } })
    await act(async () => setInputValue(input, 'Claimed'))
    await act(async () => click(findButtonByText(container, copy.save)))
    expect(input).toHaveAccessibleDescription(copy.taken)
    expect(mockRefetch).not.toHaveBeenCalled()

    let finish!: () => void
    auth.updateUser.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({})
      })
    )
    await act(async () => setInputValue(input, ' AdaTwo '))
    await act(async () => click(findButtonByText(container, copy.save)))
    expect(input).toBeDisabled()
    expect(findButtonByText(container, copy.save)).toBeDisabled()
    expect(findButtonByText(container, copy.cancel)).toBeDisabled()
    expect(auth.isUsernameAvailable).toHaveBeenLastCalledWith({ username: 'AdaTwo' })
    expect(auth.updateUser).toHaveBeenLastCalledWith({ username: 'AdaTwo' })
    await act(async () => finish())
    expect(mockRefetch).toHaveBeenCalledOnce()
    expect(container.querySelector('#username')).toBeNull()
    expect(container.textContent).toContain('Ada Lovelace')
  })

  it('shows independent localized email link status and sends only the account ID', async () => {
    const copy = getPublicCopy('es').workspace.settingsModal.account
    await act(async () => renderAccountSettings(root, 'es'))
    const group = container.querySelector<HTMLElement>(
      `[role="group"][aria-label="${copy.emailAddress}"]`
    )!
    const button = findButtonByText(group, copy.sendLink)
    expect(group).toHaveTextContent('ada@example.com')
    expect(group).toHaveTextContent('15 minutos')
    expect(group.querySelector('input')).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }))
    await act(async () => click(button))
    expect(group.querySelector('[role="status"]')).toHaveTextContent(copy.status.emailResetFailed)
    let finish!: () => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve(new Response(null, { status: 204 }))
      })
    )
    await act(async () => click(button))
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(copy.sending)
    expect(group.querySelector('[role="status"]')).toBeNull()
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/request-email-change-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'user-1' }),
    })
    await act(async () => finish())
    expect(group.querySelector('[role="status"]')).toHaveTextContent(copy.status.emailResetSent)
    expect(container.textContent).not.toContain(copy.status.passwordResetSent)
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('offers signup verification for the matched current mailbox, then opens the existing verification screen', async () => {
    const copy = getPublicCopy('es').workspace.settingsModal.account
    const email = 'ada@example.com'
    await act(async () => renderAccountSettings(root, 'es'))
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ code: 'EMAIL_NOT_VERIFIED', email }, { status: 412 })
    )
    const group = container.querySelector<HTMLElement>(
      `[role="group"][aria-label="${copy.emailAddress}"]`
    )!
    await act(async () => click(findButtonByText(group, copy.sendLink)))
    expect(container).toHaveTextContent(formatTemplate(copy.verifyCurrentEmail, { email }))
    expect(container).not.toHaveTextContent(copy.status.emailResetSent)
    expect(auth.emailOtp.sendVerificationOtp).not.toHaveBeenCalled()
    const verify = findButtonByText(container, copy.verifyEmailButton)

    auth.getSession.mockResolvedValueOnce({ data: { user: { id: 'other', email } } })
    await act(async () => click(verify))
    expect(container).toHaveTextContent(copy.status.verificationSendFailed)
    expect(auth.emailOtp.sendVerificationOtp).not.toHaveBeenCalled()
    expect(auth.push).not.toHaveBeenCalled()
    auth.getSession.mockResolvedValue({ data: { user: { id: 'user-1', email } } })
    auth.emailOtp.sendVerificationOtp.mockResolvedValueOnce({})
    await act(async () => click(verify))
    expect(auth.emailOtp.sendVerificationOtp).toHaveBeenCalledExactlyOnceWith({
      email,
      type: 'email-verification',
    })
    expect(sessionStorage.setItem).toHaveBeenCalledWith('verificationEmail', email)
    expect(auth.push).toHaveBeenCalledExactlyOnceWith('/verify')
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
  it('localizes display name validation, profile image validation, and password reset status in zh', async () => {
    const copy = getPublicCopy('zh').workspace.settingsModal.account
    await act(async () => {
      renderAccountSettings(root, 'zh')
      await flush()
    })
    await act(async () => {
      await click(findButtonByText(container, copy.editName))
    })
    const displayNameInput = container.querySelector('#displayName')
    if (!(displayNameInput instanceof HTMLInputElement)) {
      throw new Error('Expected editable display name input to render')
    }
    expect(displayNameInput).toHaveAccessibleName(copy.displayName)

    await act(async () => {
      setInputValue(displayNameInput, '   ')
      await flush()
    })
    await act(async () => {
      await click(findButtonByText(container, copy.saveName))
    })
    expect(container.textContent).toContain(copy.status.nameRequiredValidation)
    await act(async () => setInputValue(displayNameInput, '  Blue Goose  '))
    await act(async () => click(findButtonByText(container, copy.saveName)))
    expect(fetch).toHaveBeenLastCalledWith('/api/users/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Blue Goose' }),
    })
    expect(container).toHaveTextContent('Blue Goose')
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
      const group = container.querySelector<HTMLElement>(
        `[role="group"][aria-label="${copy.passwordReset}"]`
      )!
      await click(findButtonByText(group, copy.sendLink))
    })
    expect(container.textContent).toContain(copy.status.passwordResetSent)
  })
})
