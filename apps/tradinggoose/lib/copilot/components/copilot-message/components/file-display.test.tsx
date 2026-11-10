/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MessageFileAttachment } from '@/stores/copilot/types'

vi.mock('next-intl', () => ({ useLocale: () => 'en' }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ render }: any) => render,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
}))

import { FileAttachmentDisplay, NativeFileDisplay } from './file-display'

const file: MessageFileAttachment = {
  id: 'image',
  filename: 'owned.png',
  key: 'copilot/user id/a?b.png',
  sourceProof: 'signed+proof=&with?chars',
  media_type: 'image/png',
  size: 100,
}
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
it.each(['actual workspace', null])(
  'uses the actual current source proof and %s scope for both rendered image and opened URL',
  async (workspaceId) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await act(async () =>
      root.render(<FileAttachmentDisplay fileAttachments={[file]} workspaceId={workspaceId} />)
    )
    const image = container.querySelector('img')!
    const url = new URL(image.src)
    expect(url.pathname).toBe(`/api/files/serve/${encodeURIComponent(file.key)}`)
    expect(url.searchParams.get('context')).toBe('copilot')
    expect(url.searchParams.get('sourceProof')).toBe(file.sourceProof)
    expect(url.searchParams.get('workspaceId')).toBe(workspaceId)
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
    expect(open).toHaveBeenCalledWith(image.getAttribute('src'), '_blank', 'noopener,noreferrer')
  }
)
it('never falls back to unsigned loading/opening when the runtime descriptor lacks a proof', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  await act(async () =>
    root.render(
      <FileAttachmentDisplay
        fileAttachments={[{ ...file, sourceProof: '' }]}
        workspaceId='workspace'
      />
    )
  )
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('button')).toBeDisabled()
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
  expect(open).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Upload the file again')
})
it('keeps an expired/failed image unavailable without fabricating or refreshing a retained-history proof', async () => {
  await act(async () =>
    root.render(<FileAttachmentDisplay fileAttachments={[file]} workspaceId='workspace' />)
  )
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('refresh authorization')
})
it('renders retained authorized native bytes without an upload proof, source locator or refresh request', async () => {
  const data =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
  const fetcher = vi.spyOn(globalThis, 'fetch')
  await act(async () => root.render(<NativeFileDisplay file={{ data, mimeType: 'image/png' }} />))
  expect(container.querySelector('img')?.getAttribute('src')).toBe(data)
  expect(container.innerHTML).not.toContain('sourceProof')
  expect(container.innerHTML).not.toContain('/api/files')
  expect(fetcher).not.toHaveBeenCalled()
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('[role="status"]')).toHaveTextContent(
    'Conversation image is unavailable'
  )
  expect(fetcher).not.toHaveBeenCalled()
})
