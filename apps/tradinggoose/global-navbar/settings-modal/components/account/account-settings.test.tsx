/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGeneralSettingsResponsePatch } from '@/hooks/queries/general-settings'
import { organizationKeys } from '@/hooks/queries/organization'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { AccountSettings } from './account-settings'

const mockUseSession = vi.fn()
const mockSetTelemetryEnabled = vi.fn()
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  request: vi.fn(),
  change: vi.fn(),
  refetch: vi.fn(),
}))
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
  client: {
    emailOtp: {
      sendVerificationOtp: mocks.send,
      requestEmailChange: mocks.request,
      changeEmail: mocks.change,
    },
  },
  useSession: () => mockUseSession(),
}))
vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: typeof generalState) => unknown) => selector(generalState),
}))

function renderAccountSettings(root: Root, locale: LocaleCode) {
  root.render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
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
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
    mockSetTelemetryEnabled.mockReset()
    vi.clearAllMocks()
    mocks.send.mockResolvedValue({ data: { success: true }, error: null })
    mocks.request.mockResolvedValue({ data: { success: true }, error: null })
    mocks.change.mockResolvedValue({ data: { success: true }, error: null })
    mocks.refetch.mockResolvedValue(undefined)
    mockUseSession.mockReturnValue({
      refetch: mocks.refetch,
      data: {
        user: {
          id: 'user-1',
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
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'elementFromPoint')
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
  describe('email changes', () => {
    let copy: ReturnType<
      typeof getPublicCopy
    >['workspace']['settingsModal']['account']['emailChange']
    async function render(locale: LocaleCode = 'en') {
      copy = getPublicCopy(locale).workspace.settingsModal.account.emailChange
      await act(async () => {
        renderAccountSettings(root, locale)
        await flush()
      })
      await press(getPublicCopy(locale).workspace.settingsModal.account.editEmail)
    }
    async function press(text: string) {
      await act(async () => {
        await click(findButtonByText(container, text))
      })
    }
    async function fill(selector: string, value: string) {
      await act(async () => {
        setInputValue(container.querySelector<HTMLInputElement>(selector)!, value)
        await flush()
      })
    }
    async function start() {
      await fill('#account-new-email', '  New@Example.com  ')
      await press(copy.sendCode)
    }
    async function verifyCurrent() {
      await fill('#account-email-code', '111111')
      await press(copy.verifyCurrent)
    }
    it('changes the email only after both mailboxes are verified, then refreshes session and identity queries', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await render()
      await start()
      expect(mocks.send).toHaveBeenCalledWith({
        email: 'ada@example.com',
        type: 'email-verification',
      })
      expect(container.textContent).toContain('ada@example.com')
      await verifyCurrent()
      expect(mocks.request).toHaveBeenCalledWith({ newEmail: 'new@example.com', otp: '111111' })
      expect(mocks.change).not.toHaveBeenCalled()
      await fill('#account-email-code', '222222')
      await press(copy.confirm)

      expect(mocks.change).toHaveBeenCalledWith({ newEmail: 'new@example.com', otp: '222222' })
      expect(container.textContent).toContain('new@example.com')
      expect(mocks.refetch).toHaveBeenCalledOnce()
      expect(invalidate).toHaveBeenCalledWith({ queryKey: organizationKeys.all })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: workspaceKeys.all })
      expect(container.textContent).toContain(copy.success)
      expect(container.querySelector('form')).toBeNull()
    })

    it('restarts current-mailbox proof to resend the new-mailbox code while retaining its target', async () => {
      await render()
      await start()
      await verifyCurrent()
      await press(copy.restart)
      expect(mocks.send).toHaveBeenCalledTimes(2)
      expect(mocks.request).toHaveBeenCalledOnce()
      expect(container.querySelector('label[for="account-email-code"]')?.textContent).toBe(
        copy.currentCode
      )
      await fill('#account-email-code', '333333')
      await press(copy.verifyCurrent)
      expect(mocks.request).toHaveBeenLastCalledWith({ newEmail: 'new@example.com', otp: '333333' })
      expect(mocks.change).not.toHaveBeenCalled()
    })

    it('rejects letters in real OTP inputs without blocking resend or restart', async () => {
      await render()
      await start()
      for (const value of ['abcdef', '12ab34']) {
        await fill('#account-email-code', value)
        expect(container.querySelector('#account-email-code')).toHaveValue('')
        expect(findButtonByText(container, copy.verifyCurrent)).toBeDisabled()
      }
      await press(copy.resend)
      expect(mocks.send).toHaveBeenCalledTimes(2)
      await verifyCurrent()
      expect(mocks.request).toHaveBeenCalledWith({ newEmail: 'new@example.com', otp: '111111' })
      await fill('#account-email-code', '12ab34')
      expect(container.querySelector('#account-email-code')).toHaveValue('')
      expect(findButtonByText(container, copy.confirm)).toBeDisabled()
      await press(copy.restart)
      expect(mocks.send).toHaveBeenCalledTimes(3)
      await verifyCurrent()
      await fill('#account-email-code', '222222')
      expect(findButtonByText(container, copy.confirm)).toBeEnabled()
      await press(copy.confirm)
      expect(mocks.change).toHaveBeenCalledWith({ newEmail: 'new@example.com', otp: '222222' })
    })

    it.each(['es', 'zh'] as const)(
      'localizes invalid current codes and lets the user resend in %s',
      async (locale) => {
        mocks.request.mockResolvedValueOnce({
          error: { code: 'INVALID_OTP', message: 'Invalid OTP' },
        })
        await render(locale)
        await start()
        await verifyCurrent()
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.invalidCode)
        expect(container.querySelector('label[for="account-email-code"]')?.textContent).toBe(
          copy.currentCode
        )
        await press(copy.resend)
        expect(mocks.send).toHaveBeenCalledTimes(2)
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(mocks.change).not.toHaveBeenCalled()
      }
    )

    it('retries failed new-mail delivery by requesting fresh current-mailbox proof', async () => {
      mocks.request.mockResolvedValueOnce({ error: { status: 500, message: 'Delivery failed' } })
      await render()
      await start()
      await verifyCurrent()
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.sendFailed)
      expect(container.querySelector('#account-new-email')).toHaveValue('new@example.com')
      await press(copy.sendCode)
      expect(mocks.send).toHaveBeenCalledTimes(2)
      expect(mocks.request).toHaveBeenCalledOnce()
      expect(container.querySelector('label[for="account-email-code"]')?.textContent).toBe(
        copy.currentCode
      )
    })

    it.each([
      ['OTP_EXPIRED', 'expiredCode'],
      ['TOO_MANY_ATTEMPTS', 'tooManyAttempts'],
      ['UNAUTHORIZED', 'sessionExpired'],
    ] as const)('keeps a failed new-code confirmation recoverable for %s', async (code, key) => {
      mocks.change.mockResolvedValueOnce({ error: { code } })
      await render()
      await start()
      await verifyCurrent()
      await fill('#account-email-code', '222222')
      await press(copy.confirm)
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.errors[key])
      expect(container.querySelector('form')).not.toBeNull()
      expect(container.querySelector('#account-email-code')).toHaveValue('')
      await press(copy.cancel)
      expect(container.querySelector('form')).toBeNull()
      expect(container.textContent).toContain('ada@example.com')
    })

    it('blocks duplicate submits and edits while a code is being sent', async () => {
      let finish!: (result: { error: null }) => void
      mocks.send.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      await render()
      await fill('#account-new-email', 'new@example.com')
      const form = container.querySelector('form')!
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(mocks.send).toHaveBeenCalledOnce()
      expect(container.querySelector('button[type="submit"]')).toBeDisabled()
      expect(container.querySelector('#account-new-email')).toBeDisabled()
      await act(async () => finish({ error: null }))
      await press(copy.cancel)
      expect(container.querySelector('form')).toBeNull()
      expect(container.textContent).toContain('ada@example.com')
    })

    it('keeps successful email mutation successful when session and cache refresh fail', async () => {
      mocks.refetch.mockRejectedValueOnce(new Error('Session refresh failed'))
      vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(
        new Error('Cache refresh failed')
      )
      await render()
      await start()
      await verifyCurrent()
      await fill('#account-email-code', '222222')
      await press(copy.confirm)
      expect(container.textContent).toContain('new@example.com')
      expect(container.textContent).toContain(copy.success)
      expect(container.querySelector('[role="alert"]')).toBeNull()
      await press(getPublicCopy('en').workspace.settingsModal.account.editEmail)
      expect(container.querySelector('#account-new-email')).toHaveValue('new@example.com')
    })
  })
})
