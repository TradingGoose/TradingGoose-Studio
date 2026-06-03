/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { formatTemplate } from '@/i18n/utils'
import type { LocaleCode } from '@/i18n/utils'
import { AccountSettings } from './account-settings'

const mockUseSession = vi.fn()
const mockUseGeneralSettings = vi.fn()
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
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
}))

vi.mock('@/hooks/queries/general-settings', () => ({
  useGeneralSettings: () => mockUseGeneralSettings(),
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: typeof generalState) => unknown) => selector(generalState),
}))

function renderAccountSettings(root: Root, locale: LocaleCode) {
  root.render(
    <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
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
    mockSetTelemetryEnabled.mockReset()
    mockUseGeneralSettings.mockReturnValue({ isPending: false })
    mockUseSession.mockReturnValue({
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
