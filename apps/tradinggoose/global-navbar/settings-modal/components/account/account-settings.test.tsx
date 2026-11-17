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
import { getClientMessages, getPublicCopy } from '@/i18n/public-copy'
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
  updateUser: vi.fn(),
  isUsernameAvailable: vi.fn(),
  requestPasswordReset: vi.fn(),
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
    updateUser: mocks.updateUser,
    isUsernameAvailable: mocks.isUsernameAvailable,
    requestPasswordReset: mocks.requestPasswordReset,
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
    mocks.refetch.mockReset().mockResolvedValue(undefined)
    mocks.updateUser.mockReset().mockResolvedValue({ data: { status: true }, error: null })
    mocks.isUsernameAvailable
      .mockReset()
      .mockResolvedValue({ data: { available: true }, error: null })
    mocks.requestPasswordReset
      .mockReset()
      .mockResolvedValue({ data: { status: true }, error: null })
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

    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
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
    expect(global.fetch).not.toHaveBeenCalled()
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
  describe('native profile updates', () => {
    const copy = getPublicCopy('en').workspace.settingsModal.account
    async function render() {
      await act(async () => {
        renderAccountSettings(root, 'en')
        await flush()
      })
    }
    async function press(text: string) {
      await act(async () => {
        await click(findButtonByText(container, text))
      })
    }
    function changeSession(values: Record<string, string | null>) {
      const previous = mockUseSession()
      mockUseSession.mockReturnValue({
        ...previous,
        data: { ...previous.data, user: { ...previous.data.user, ...values } },
      })
    }
    async function uploadImage(uploadResponse?: Promise<Response>) {
      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL = vi.fn(() => 'blob:profile-preview')
          static revokeObjectURL = vi.fn()
        }
      )
      vi.mocked(global.fetch).mockImplementation(async (input) =>
        uploadResponse && String(input) === '/api/files/upload'
          ? uploadResponse
          : ({
              ok: true,
              json: async () =>
                String(input).includes('/presigned')
                  ? { directUploadSupported: false }
                  : { path: '/api/files/serve/new-avatar.png' },
            } as Response)
      )
      await act(async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [new File(['avatar'], 'avatar.png', { type: 'image/png' })],
        })
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await flush()
      })
    }

    it('retains a saved name through stale session responses and failed refresh until acknowledged', async () => {
      await render()
      await press(copy.editName)
      await act(async () => {
        setInputValue(
          container.querySelector<HTMLInputElement>('#accountName')!,
          '  Grace Hopper  '
        )
      })
      await press(copy.saveName)
      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ name: 'Grace Hopper' })
      expect(container.textContent).toContain('Grace Hopper')
      expect(global.fetch).not.toHaveBeenCalled()

      changeSession({ name: 'Ada Lovelace' })
      mockUseSession.mockReturnValue({
        ...mockUseSession(),
        error: new Error('Session refresh failed'),
      })
      await render()
      expect(container.textContent).toContain('Grace Hopper')
      expect(container.textContent).not.toContain('Ada Lovelace')
      changeSession({ name: 'Grace Hopper' })
      await render()
      changeSession({ name: 'Updated elsewhere' })
      await render()
      expect(container.textContent).toContain('Updated elsewhere')
      expect(container.textContent).not.toContain('Grace Hopper')
    })

    it('acknowledges confirmed profile fields independently while preserving other pending saves', async () => {
      await render()
      await press(copy.editName)
      act(() =>
        setInputValue(container.querySelector<HTMLInputElement>('#accountName')!, 'Grace Hopper')
      )
      await press(copy.saveName)
      await press(copy.editUsername)
      act(() =>
        setInputValue(container.querySelector<HTMLInputElement>('#accountUsername')!, 'New.Handle')
      )
      await press(copy.saveUsername)

      changeSession({ name: 'Ada Lovelace', username: 'new.handle', displayUsername: 'New.Handle' })
      await render()
      expect(container.textContent).toContain('Grace Hopper')
      changeSession({ username: 'other.handle', displayUsername: 'Other.Handle' })
      await render()
      expect(container.textContent).toContain('Other.Handle')
      expect(container.textContent).toContain('Grace Hopper')
      changeSession({ name: 'Grace Hopper' })
      await render()
      changeSession({ name: 'Updated elsewhere' })
      await render()
      expect(container.textContent).toContain('Updated elsewhere')
      expect(container.textContent).not.toContain('Grace Hopper')
    })

    it('releases a confirmed value when its session acknowledgment precedes the mutation callback', async () => {
      let finish!: (value: { error: null }) => void
      mocks.updateUser.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      await render()
      await press(copy.editName)
      act(() =>
        setInputValue(container.querySelector<HTMLInputElement>('#accountName')!, 'Grace Hopper')
      )
      await press(copy.saveName)
      changeSession({ name: 'Grace Hopper' })
      await render()
      await act(async () => {
        finish({ error: null })
        await flush()
      })
      changeSession({ name: 'Updated elsewhere' })
      await render()
      expect(container.textContent).toContain('Updated elsewhere')
      expect(container.textContent).not.toContain('Grace Hopper')
    })

    it('keeps a failed native name update editable with its translated error', async () => {
      mocks.updateUser.mockResolvedValueOnce({ error: { code: 'UPDATE_FAILED' } })
      await render()
      await press(copy.editName)
      await act(async () => {
        setInputValue(container.querySelector<HTMLInputElement>('#accountName')!, 'Grace Hopper')
      })
      await press(copy.saveName)
      expect(container.querySelector('#accountName')).toHaveValue('Grace Hopper')
      expect(container.textContent).toContain(copy.status.unableToUpdateName)
      expect(mocks.refetch).not.toHaveBeenCalled()
    })

    it('saves an uploaded image natively and accepts a later session image removal', async () => {
      mockUseSession.mockReturnValue({
        ...mockUseSession(),
        error: new Error('Session refresh failed'),
      })
      await render()
      await uploadImage()
      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
        image: '/api/files/serve/new-avatar.png',
      })
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        '/api/files/serve/new-avatar.png'
      )
      expect(container.querySelector('input[type="file"]')).toBeEnabled()

      changeSession({ image: null })
      await render()
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        '/api/files/serve/new-avatar.png'
      )
      changeSession({ image: '/api/files/serve/new-avatar.png' })
      await render()
      changeSession({ image: null })
      await render()
      expect(container.querySelector('img')).toHaveAttribute('src', '/profile/avatar.png')
    })

    it('awaits image persistence, reports a failed save and restores the existing preview', async () => {
      let complete!: (value: { error: { code: string } }) => void
      mocks.updateUser.mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve
        })
      )
      changeSession({ image: '/api/files/serve/original-avatar.png' })
      await render()
      await uploadImage()
      expect(container.querySelector('input[type="file"]')).toBeDisabled()
      expect(mocks.refetch).not.toHaveBeenCalled()
      await act(async () => {
        complete({ error: { code: 'UPDATE_FAILED' } })
        await flush()
      })
      expect(container.textContent).toContain(copy.status.profilePictureUpdateError)
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        '/api/files/serve/original-avatar.png'
      )
      expect(container.querySelector('input[type="file"]')).toBeEnabled()
    })

    it.each(['success', 'error'])(
      'discards an old account upload %s after a session switch with the same empty avatar',
      async (result) => {
        let complete!: (value: Response) => void
        let fail!: (error: Error) => void
        const uploadResponse = new Promise<Response>((resolve, reject) => {
          complete = resolve
          fail = reject
        })
        await render()
        await uploadImage(uploadResponse)
        changeSession({ id: 'user-2', name: 'Bob', email: 'bob@example.com' })
        await render()
        expect(container.querySelector('img')).toHaveAttribute('src', '/profile/avatar.png')
        expect(container.querySelector('input[type="file"]')).toBeEnabled()
        await act(async () => {
          if (result === 'error') fail(new Error('Old upload failed'))
          else complete(Response.json({ path: '/api/files/serve/ada-upload.png' }))
          await flush()
        })
        expect(mocks.updateUser).not.toHaveBeenCalled()
        expect(container.textContent).toContain('Bob')
        expect(container.textContent).not.toContain(copy.status.unableToUpdateProfilePicture)
        expect(container.querySelector('img')).toHaveAttribute('src', '/profile/avatar.png')
        expect(container.querySelector('input[type="file"]')).toBeEnabled()
      }
    )

    it.each([false, true])(
      'preserves a newer upload when an old account completes after switching back: %s',
      async (returnToOriginal) => {
        let finishOld!: (value: Response) => void
        const oldUpload = new Promise<Response>((resolve) => {
          finishOld = resolve
        })
        await render()
        await uploadImage(oldUpload)
        changeSession({ id: 'user-2', name: 'Bob', email: 'bob@example.com' })
        await render()
        if (returnToOriginal) {
          changeSession({ id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' })
          await render()
        }
        let finishNew!: (value: Response) => void
        const newUpload = new Promise<Response>((resolve) => {
          finishNew = resolve
        })
        await uploadImage(newUpload)
        await act(async () => {
          finishOld(Response.json({ path: '/api/files/serve/old-avatar.png' }))
          await flush()
        })
        expect(mocks.updateUser).not.toHaveBeenCalled()
        expect(container.querySelector('input[type="file"]')).toBeDisabled()
        await act(async () => {
          finishNew(Response.json({ path: '/api/files/serve/new-avatar.png' }))
          await flush()
        })
        expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
          image: '/api/files/serve/new-avatar.png',
        })
        expect(container.querySelector('img')).toHaveAttribute(
          'src',
          '/api/files/serve/new-avatar.png'
        )
        expect(container.querySelector('input[type="file"]')).toBeEnabled()
      }
    )

    it('sends native password-reset requests using the localized redirect', async () => {
      await act(async () => {
        renderAccountSettings(root, 'es')
        await flush()
      })
      await press(getPublicCopy('es').workspace.settingsModal.account.sendLink)
      expect(mocks.requestPasswordReset).toHaveBeenCalledExactlyOnceWith({
        email: 'ada@example.com',
        redirectTo: expect.stringContaining('/es/reset-password'),
      })
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })
  describe('username editing', () => {
    const copy = getPublicCopy('en').workspace.settingsModal.account
    function setSession(username: string | null, id = 'user-1') {
      mockUseSession.mockReturnValue({
        refetch: mocks.refetch,
        data: {
          user: {
            id,
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            username: username?.toLowerCase() ?? null,
            displayUsername: username,
          },
        },
      })
    }
    async function render() {
      await act(async () => {
        renderAccountSettings(root, 'en')
        await flush()
      })
    }
    async function press(text: string) {
      await act(async () => {
        await click(findButtonByText(container, text))
      })
    }
    async function edit(value: string) {
      await press(copy.editUsername)
      await act(async () => {
        setInputValue(container.querySelector<HTMLInputElement>('#accountUsername')!, value)
        await flush()
      })
    }
    const usernameRow = () =>
      container.querySelector('label[for="accountUsername"]')!.parentElement!
    async function waitForAvailability() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350))
      })
      await act(async () => flush())
    }

    it.each(['available', 'taken', 'error'] as const)(
      'shows native username availability %s while leaving server validation authoritative',
      async (status) => {
        mocks.isUsernameAvailable.mockResolvedValue(
          status === 'error'
            ? { data: null, error: { status: 503 } }
            : { data: { available: status === 'available' }, error: null }
        )
        setSession('Ada.Handle')
        await render()
        await edit('New.Handle')
        expect(usernameRow().querySelector('[role="status"]')?.textContent).toBe(
          copy.usernameAvailability.checking
        )
        expect(findButtonByText(container, copy.saveUsername)).toBeEnabled()
        await waitForAvailability()
        expect(mocks.isUsernameAvailable).toHaveBeenCalledWith(
          { username: 'new.handle' },
          { signal: expect.any(AbortSignal) }
        )
        if (status === 'taken') {
          expect(usernameRow().querySelector('[role="alert"]')?.textContent).toBe(
            copy.status.usernameTaken
          )
          expect(container.querySelector('#accountUsername')).toHaveAttribute(
            'aria-invalid',
            'true'
          )
          expect(findButtonByText(container, copy.saveUsername)).toBeDisabled()
          await act(async () => {
            container
              .querySelector('#accountUsername')!
              .closest('form')!
              .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          })
          expect(mocks.updateUser).not.toHaveBeenCalled()
        } else {
          expect(usernameRow().querySelector('[role="status"]')?.textContent).toBe(
            copy.usernameAvailability[status]
          )
          await press(copy.saveUsername)
          expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
            username: 'New.Handle',
            displayUsername: 'New.Handle',
          })
        }
      }
    )

    it.each(['', 'ADA.HANDLE', 'invalid username'])(
      'skips availability for the current username or invalid input: %s',
      async (value) => {
        setSession('Ada.Handle')
        await render()
        await edit(value)
        await waitForAvailability()
        expect(mocks.isUsernameAvailable).not.toHaveBeenCalled()
        expect(usernameRow().querySelector('[role="status"]')).toBeNull()
        if (value === 'ADA.HANDLE') {
          await press(copy.saveUsername)
          expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
            username: value,
            displayUsername: value,
          })
        }
      }
    )

    it.each([false, true])(
      'ignores an abandoned candidate result with availability %s',
      async (oldAvailable) => {
        let finish!: (value: { data: { available: boolean }; error: null }) => void
        mocks.isUsernameAvailable.mockImplementation(({ username }) =>
          username === 'old.handle'
            ? new Promise((resolve) => {
                finish = resolve
              })
            : Promise.resolve({ data: { available: !oldAvailable }, error: null })
        )
        setSession('Ada.Handle')
        await render()
        await edit('Old.Handle')
        await waitForAvailability()
        const signal = mocks.isUsernameAvailable.mock.calls[0][1].signal as AbortSignal
        await act(async () => {
          setInputValue(
            container.querySelector<HTMLInputElement>('#accountUsername')!,
            'New.Handle'
          )
        })
        expect(signal.aborted).toBe(true)
        await waitForAvailability()
        await act(async () => {
          finish({ data: { available: oldAvailable }, error: null })
          await flush()
        })
        expect(
          usernameRow().querySelector(oldAvailable ? '[role="alert"]' : '[role="status"]')
            ?.textContent
        ).toBe(oldAvailable ? copy.status.usernameTaken : copy.usernameAvailability.available)
        expect(findButtonByText(container, copy.saveUsername).disabled).toBe(oldAvailable)
      }
    )

    it('debounces typing and aborts checks when candidates, editing, or accounts change', async () => {
      mocks.isUsernameAvailable.mockImplementation(
        (_body, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
      setSession('Ada.Handle')
      await render()
      await press(copy.editUsername)
      vi.useFakeTimers()
      try {
        const input = container.querySelector<HTMLInputElement>('#accountUsername')!
        act(() => setInputValue(input, 'First.Handle'))
        await act(async () => vi.advanceTimersByTimeAsync(200))
        act(() => setInputValue(input, 'Second.Handle'))
        await act(async () => vi.advanceTimersByTimeAsync(299))
        expect(mocks.isUsernameAvailable).not.toHaveBeenCalled()
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.isUsernameAvailable).toHaveBeenCalledExactlyOnceWith(
          { username: 'second.handle' },
          { signal: expect.any(AbortSignal) }
        )
        const firstSignal = mocks.isUsernameAvailable.mock.calls[0][1].signal as AbortSignal
        act(() => setInputValue(input, 'Third.Handle'))
        expect(firstSignal.aborted).toBe(true)
        await act(async () => vi.advanceTimersByTimeAsync(300))
        const secondSignal = mocks.isUsernameAvailable.mock.calls[1][1].signal as AbortSignal
        act(() => findButtonByText(container, copy.cancelEditingUsername).click())
        expect(secondSignal.aborted).toBe(true)
        expect(container.querySelector('#accountUsername')).toBeNull()

        act(() => findButtonByText(container, copy.editUsername).click())
        act(() =>
          setInputValue(
            container.querySelector<HTMLInputElement>('#accountUsername')!,
            'Fourth.Handle'
          )
        )
        await act(async () => vi.advanceTimersByTimeAsync(300))
        const finalSignal = mocks.isUsernameAvailable.mock.calls[2][1].signal as AbortSignal
        setSession('Bob.Handle', 'user-2')
        act(() => renderAccountSettings(root, 'en'))
        expect(finalSignal.aborted).toBe(true)
        expect(usernameRow().textContent).toContain('Bob.Handle')
        await act(async () => vi.advanceTimersByTimeAsync(500))
        expect(mocks.isUsernameAvailable).toHaveBeenCalledTimes(3)
        expect(mocks.updateUser).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('lets a user choose a username through the native update API, preserving display case', async () => {
      setSession(null)
      await render()
      await edit('First.Handle')
      await press(copy.saveUsername)

      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
        username: 'First.Handle',
        displayUsername: 'First.Handle',
      })
      expect(usernameRow().textContent).toContain('First.Handle')
      expect(container.querySelector('#accountUsername')).toBeNull()
      expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(
        false
      )
    })

    it('retains a confirmed change when session refresh fails and allows cancelling another edit', async () => {
      setSession('Ada.Handle')
      mockUseSession.mockReturnValue({
        ...mockUseSession(),
        error: new Error('Session refresh failed'),
      })
      await render()
      await edit('New.Handle')
      await press(copy.saveUsername)

      expect(usernameRow().textContent).toContain('New.Handle')
      expect(usernameRow().querySelector('[role="alert"]')).toBeNull()
      await edit('Discard.Handle')
      await press(copy.cancelEditingUsername)
      expect(usernameRow().textContent).toContain('New.Handle')
      expect(usernameRow().textContent).not.toContain('Discard.Handle')
      expect(mocks.updateUser).toHaveBeenCalledOnce()
    })

    it('shows duplicate errors inline and preserves the existing username after cancelling', async () => {
      setSession('Ada.Handle')
      mocks.updateUser.mockResolvedValueOnce({ error: { code: 'USERNAME_IS_ALREADY_TAKEN' } })
      await render()
      await edit('Taken.Handle')
      await waitForAvailability()
      await press(copy.saveUsername)

      expect(usernameRow().querySelector('[role="alert"]')?.textContent).toBe(
        copy.status.usernameTaken
      )
      expect(container.querySelector<HTMLInputElement>('#accountUsername')?.value).toBe(
        'Taken.Handle'
      )
      expect(mocks.refetch).not.toHaveBeenCalled()
      await press(copy.cancelEditingUsername)
      expect(usernameRow().textContent).toContain('Ada.Handle')
    })

    it('ignores a completed update after the signed-in identity changes', async () => {
      let complete!: (value: { error: null }) => void
      mocks.updateUser.mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve
        })
      )
      setSession('Ada.Handle')
      await render()
      await edit('New.Handle')
      await press(copy.saveUsername)
      setSession('Bob.Handle', 'user-2')
      await render()
      await act(async () => {
        complete({ error: null })
        await flush()
      })

      expect(usernameRow().textContent).toContain('Bob.Handle')
      expect(usernameRow().textContent).not.toContain('New.Handle')
      expect(container.querySelector('#accountUsername')).toBeNull()
      expect(mocks.refetch).not.toHaveBeenCalled()
    })

    it('submits a pending edit only once', async () => {
      let complete!: (value: { error: null }) => void
      mocks.updateUser.mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve
        })
      )
      setSession('Ada.Handle')
      await render()
      await edit('New.Handle')
      await act(async () => {
        const form = container.querySelector('#accountUsername')!.closest('form')!
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await flush()
      })

      expect(mocks.updateUser).toHaveBeenCalledOnce()
      expect(container.querySelector<HTMLInputElement>('#accountUsername')?.disabled).toBe(true)
      await act(async () => {
        complete({ error: null })
        await flush()
      })
      expect(usernameRow().textContent).toContain('New.Handle')
    })
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
      const expectPrivateSlots = (digit: string) => {
        const input = container.querySelector('#account-email-code')!
        const protectedContainer = input.closest('.ph-no-capture')
        expect(protectedContainer).not.toBeNull()
        const slots = [...container.querySelectorAll('div')].filter(
          (element) => element.childElementCount === 0 && element.textContent === digit
        )
        expect(slots).toHaveLength(6)
        for (const slot of slots) expect(protectedContainer?.contains(slot)).toBe(true)
      }
      await render()
      await start()
      for (const value of ['abcdef', '12ab34']) {
        await fill('#account-email-code', value)
        expect(container.querySelector('#account-email-code')).toHaveValue('')
        expect(findButtonByText(container, copy.verifyCurrent)).toBeDisabled()
      }
      await press(copy.resend)
      expect(mocks.send).toHaveBeenCalledTimes(2)
      await fill('#account-email-code', '111111')
      expectPrivateSlots('1')
      await press(copy.verifyCurrent)
      expect(mocks.request).toHaveBeenCalledWith({ newEmail: 'new@example.com', otp: '111111' })
      await fill('#account-email-code', '12ab34')
      expect(container.querySelector('#account-email-code')).toHaveValue('')
      expect(findButtonByText(container, copy.confirm)).toBeDisabled()
      await press(copy.restart)
      expect(mocks.send).toHaveBeenCalledTimes(3)
      await verifyCurrent()
      await fill('#account-email-code', '222222')
      expectPrivateSlots('2')
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
      const stale = mockUseSession()
      mockUseSession.mockReturnValue({
        ...stale,
        data: { ...stale.data, user: { ...stale.data.user } },
      })
      await act(async () => {
        renderAccountSettings(root, 'en')
        await flush()
      })
      expect(container.textContent).toContain('new@example.com')
      await press(getPublicCopy('en').workspace.settingsModal.account.sendLink)
      expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
        email: 'new@example.com',
        redirectTo: expect.stringContaining('/reset-password'),
      })
      await press(getPublicCopy('en').workspace.settingsModal.account.editEmail)
      expect(container.querySelector('#account-new-email')).toHaveValue('new@example.com')
    })
  })
})
