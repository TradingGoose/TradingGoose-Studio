/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { formatTemplate } from '@/i18n/utils'
import type { LocaleCode } from '@/i18n/utils'
import { HelpModal } from './help-modal'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const originalScrollTo = HTMLElement.prototype.scrollTo
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock('browser-image-compression', () => ({
  default: vi.fn(async (file: File) => file),
}))

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

vi.mock('../../settings-modal', () => ({
  SettingsModal: ({
    title,
    children,
  }: {
    title: string
    children: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')

  type SelectContextValue = {
    onValueChange: (value: string) => void
    value: string
  }

  const SelectContext = React.createContext<SelectContextValue>({
    onValueChange: () => undefined,
    value: '',
  })

  return {
    Select: ({
      defaultValue = '',
      onValueChange,
      children,
    }: {
      defaultValue?: string
      onValueChange?: (value: string) => void
      children: React.ReactNode
    }) => {
      const [value, setValue] = React.useState(defaultValue)

      const handleChange = (nextValue: string) => {
        setValue(nextValue)
        onValueChange?.(nextValue)
      }

      return (
        <SelectContext.Provider value={{ onValueChange: handleChange, value }}>
          {children}
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({
      id,
      className,
      children,
    }: {
      id?: string
      className?: string
      children: React.ReactNode
    }) => (
      <div id={id} className={className}>
        {children}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const { value } = React.useContext(SelectContext)
      return <span>{value || placeholder}</span>
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      value,
      children,
    }: {
      value: string
      children: React.ReactNode
    }) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <button type='button' onClick={() => onValueChange(value)}>
          {children}
        </button>
      )
    },
  }
})

function renderHelpModal(root: Root, locale: LocaleCode) {
  root.render(
    <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
      <HelpModal open onOpenChange={vi.fn()} />
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

function createSizedFile(name: string, type: string, size: number) {
  const file = new File(['image'], name, { type })
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: size,
  })
  return file
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('HelpModal localization', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    URL.createObjectURL = vi.fn(() => 'blob:preview-1')
    URL.revokeObjectURL = vi.fn()
    HTMLElement.prototype.scrollTo = vi.fn()
    vi.mocked(global.fetch).mockImplementation(async () => ({
      ok: true,
      json: async () => ({}),
    }) as Response)

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
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    HTMLElement.prototype.scrollTo = originalScrollTo
  })

  it('renders translated help copy in es', async () => {
    const copy = getPublicCopy('es').workspace.settingsModal

    await act(async () => {
      renderHelpModal(root, 'es')
      await flush()
    })

    expect(container.textContent).toContain(copy.titles.help)
    expect(container.textContent).toContain(copy.help.requestType)
    expect(container.textContent).toContain(copy.help.requestTypes.bug)
    expect(container.textContent).toContain(copy.help.requestTypes.feedback)
    expect(container.textContent).toContain(copy.help.requestTypes.feature_request)
    expect(container.textContent).toContain(copy.help.requestTypes.other)
    expect(container.textContent).toContain(copy.help.attachments)
    expect(container.textContent).toContain(copy.help.dropImagesBrowse)
    expect(container.textContent).toContain(copy.help.imageHint)

    const subjectInput = container.querySelector('#subject')
    const messageInput = container.querySelector('#message')

    expect(subjectInput).toHaveAttribute('placeholder', copy.help.subjectPlaceholder)
    expect(messageInput).toHaveAttribute('placeholder', copy.help.messagePlaceholder)
  })

  it('localizes validation, file errors, preview alt text, and submit states in zh', async () => {
    const copy = getPublicCopy('zh').workspace.settingsModal.help
    let resolveRequest: ((response: Response) => void) | null = null

    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    await act(async () => {
      renderHelpModal(root, 'zh')
      await flush()
    })

    await act(async () => {
      findButtonByText(container, copy.submit).click()
      await flush()
    })

    expect(container.textContent).toContain(copy.errorMessages.subjectRequired)
    expect(container.textContent).toContain(copy.errorMessages.messageRequired)

    const fileInput = container.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Expected help attachment input to render')
    }

    const oversizedFile = createSizedFile('error.png', 'image/png', 21 * 1024 * 1024)

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [oversizedFile],
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })

    expect(container.textContent).toContain(
      formatTemplate(copy.errorMessages.fileTooLarge, { name: oversizedFile.name })
    )

    const validImage = createSizedFile('preview.png', 'image/png', 1024)

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [validImage],
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })

    expect(container.textContent).toContain(copy.uploadedImages)
    expect(container.querySelector(`img[alt="${formatTemplate(copy.previewAlt, { index: 1 })}"]`)).not.toBeNull()

    const subjectInput = container.querySelector('#subject')
    const messageInput = container.querySelector('#message')

    if (!(subjectInput instanceof HTMLInputElement)) {
      throw new Error('Expected subject input to render')
    }
    if (!(messageInput instanceof HTMLTextAreaElement)) {
      throw new Error('Expected message input to render')
    }

    await act(async () => {
      setFieldValue(subjectInput, '需要帮助')
      setFieldValue(messageInput, '请查看此问题。')
      await flush()
    })

    await act(async () => {
      findButtonByText(container, copy.submit).click()
      await flush()
    })

    expect(container.textContent).toContain(copy.submitting)

    await act(async () => {
      resolveRequest?.({
        ok: true,
        json: async () => ({}),
      } as Response)
      await flush()
    })

    expect(container.textContent).toContain(copy.success)
  })
})
