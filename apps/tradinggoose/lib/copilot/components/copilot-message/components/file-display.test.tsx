/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeFileDisplay } from './file-display'

let root: Root
let container: HTMLDivElement
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
  vi.restoreAllMocks()
})
it('renders canonical image bytes without storage requests', async () => {
  const data =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
  const fetcher = vi.spyOn(globalThis, 'fetch')
  await act(async () => root.render(<NativeFileDisplay file={{ data, mimeType: 'image/png' }} />))
  expect(container.querySelector('img')?.getAttribute('src')).toBe(data)
  expect(container.innerHTML).not.toContain('/api/files')
  expect(fetcher).not.toHaveBeenCalled()
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('[role="status"]')).toHaveTextContent(
    'Conversation image is unavailable'
  )
  expect(fetcher).not.toHaveBeenCalled()
})
