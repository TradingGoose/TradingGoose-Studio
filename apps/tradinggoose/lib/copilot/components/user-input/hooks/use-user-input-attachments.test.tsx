/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUserInputAttachments } from './use-user-input-attachments'

let state: ReturnType<typeof useUserInputAttachments>
let root: Root
let container: HTMLDivElement
const revoke = vi.fn()
function Harness() {
  state = useUserInputAttachments({ userId: 'actor' })
  return null
}
const files = (name: string) =>
  [new File(['image'], name, { type: 'image/png' })] as unknown as FileList
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  revoke.mockClear()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (file: File) => `blob:${file.name}`,
      revokeObjectURL: revoke,
    })
  )
  await act(async () => root.render(<Harness />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('reads selected images inline without an upload and clears only submitted attachments', async () => {
  await act(async () => state.processFiles(files('first.png')))
  const submitted = state.attachedFiles.map((file) => file.id)
  expect(state.attachedFiles[0]).toMatchObject({
    data: 'data:image/png;base64,aW1hZ2U=',
    uploading: false,
  })
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => state.processFiles(files('second.png')))
  await act(async () => state.clearAttachedFiles(submitted))
  expect(state.attachedFiles.map((file) => file.name)).toEqual(['second.png'])
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first.png')
})
it('a removed submitted image cannot delete a newly uploaded image with the same filename', async () => {
  await act(async () => state.processFiles(files('same.png')))
  const submitted = state.attachedFiles.map((file) => file.id)
  await act(async () => state.removeFile(submitted[0]))
  await act(async () => state.processFiles(files('same.png')))
  const recreated = state.attachedFiles[0].id
  expect(recreated).not.toBe(submitted[0])
  const before = revoke.mock.calls.length
  await act(async () => state.clearAttachedFiles(submitted))
  expect(state.attachedFiles[0].id).toBe(recreated)
  expect(revoke).toHaveBeenCalledTimes(before)
})
