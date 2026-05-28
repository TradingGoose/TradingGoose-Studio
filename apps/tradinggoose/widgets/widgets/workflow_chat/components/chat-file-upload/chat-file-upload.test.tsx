/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatFileUpload } from './chat-file-upload'

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
}))

describe('ChatFileUpload', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('renders localized attach copy for the current locale', () => {
    act(() => {
      root.render(<ChatFileUpload files={[]} onFilesChange={vi.fn()} />)
    })

    expect(container.textContent).toContain('Adjuntar')
    expect(container.querySelector('button')?.getAttribute('title')).toBe('Adjuntar archivos')
  })

  it('emits localized validation errors from the centralized workflow chat copy', () => {
    const onError = vi.fn()

    act(() => {
      root.render(
        <ChatFileUpload
          files={[]}
          onFilesChange={vi.fn()}
          acceptedTypes={['image/png']}
          onError={onError}
        />
      )
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['test'], 'nota.txt', { type: 'text/plain' })

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [invalidFile],
    })

    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onError).toHaveBeenCalledWith(['El tipo de nota.txt no es compatible'])
  })
})
