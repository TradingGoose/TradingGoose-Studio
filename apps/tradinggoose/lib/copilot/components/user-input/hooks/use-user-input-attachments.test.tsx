/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MAX_COPILOT_REQUEST_BYTES } from '@/lib/copilot/native/request-size'
import type { CopilotDraft } from '@/stores/copilot/types'
import { useUserInputAttachments } from './use-user-input-attachments'

let state: ReturnType<typeof useUserInputAttachments>
let root: Root
let container: HTMLDivElement
const revoke = vi.fn()
const preview = vi.fn((file: File) => `blob:${file.name}`)
let draft: CopilotDraft
function Harness() {
  state = useUserInputAttachments({ userId: 'actor', draft })
  return null
}
const files = (...entries: (File | string)[]) =>
  entries.map((entry) =>
    typeof entry === 'string' ? new File(['image'], entry, { type: 'image/png' }) : entry
  ) as unknown as FileList
const image = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' })

function controlledReads() {
  const readers: ControlledReader[] = []
  class ControlledReader {
    result: string | null = null
    onload: (() => void) | null = null
    file!: File
    readAsDataURL(file: File) {
      this.file = file
      readers.push(this)
    }
    finish(data?: string) {
      const remainder = this.file.size % 3
      this.result =
        data ??
        `data:${this.file.type};base64,${'A'.repeat(Math.floor(this.file.size / 3) * 4)}${
          remainder ? 'A'.repeat(remainder + 1) + '='.repeat(3 - remainder) : ''
        }`
      this.onload?.()
    }
  }
  vi.stubGlobal('FileReader', ControlledReader)
  return readers
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  draft = { text: 'Describe these images', contexts: [] }
  revoke.mockClear()
  preview.mockClear()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: preview,
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

it('rejects an 8 MiB image before allocating a preview or reading its oversized encoding', async () => {
  const readers = controlledReads()
  let reading!: Promise<void>
  act(() => {
    reading = state.processFiles(files(image('large.png', 8 * 1024 * 1024)))
  })
  await act(async () => {
    readers.forEach((reader) => reader.finish())
    await reading
  })
  expect(readers).toHaveLength(0)
  expect(preview).not.toHaveBeenCalled()
  expect(state.attachedFiles.length).toBe(0)
  expect(state.uploadError).toContain('10 MiB')
})

it.each([
  ['empty.png', '', 'image/png', 'Image size is invalid'],
  ['document.txt', 'text', 'text/plain', 'Only image files can be attached'],
])('rejects invalid attachment %s before allocating a preview', async (name, data, type, error) => {
  const readers = controlledReads()
  await act(async () => state.processFiles(files(new File([data], name, { type }))))
  expect(readers).toHaveLength(0)
  expect(preview).not.toHaveBeenCalled()
  expect(state.attachedFiles.length).toBe(0)
  expect(state.uploadError).toBe(error)
})

it('accounts for all images in one batch and preserves those that fit', async () => {
  const readers = controlledReads()
  let reading!: Promise<void>
  act(() => {
    reading = state.processFiles(
      files(image('first.png', 4 * 1024 * 1024), image('second.png', 4 * 1024 * 1024))
    )
  })
  await act(async () => {
    readers[0].finish()
    await Promise.resolve()
    readers.slice(1).forEach((reader) => reader.finish())
    await reading
  })
  expect(readers).toHaveLength(1)
  expect(state.attachedFiles.map((file) => file.name)).toEqual(['first.png'])
  expect(state.uploadError).toContain('10 MiB')
})

it('reserves pending image bytes synchronously across concurrent selections', async () => {
  const readers = controlledReads()
  let first!: Promise<void>
  let second!: Promise<void>
  act(() => {
    first = state.processFiles(files(image('first.png', 4 * 1024 * 1024)))
    second = state.processFiles(files(image('second.png', 4 * 1024 * 1024)))
  })
  await act(async () => {
    readers.forEach((reader) => reader.finish())
    await Promise.all([first, second])
  })
  expect(readers).toHaveLength(1)
  expect(state.attachedFiles.map((file) => file.name)).toEqual(['first.png'])
  expect(state.uploadError).toContain('10 MiB')
})

it.each(['text', 'contexts'] as const)(
  'includes UTF-8 %s bytes when admitting an image',
  async (field) => {
    const readers = controlledReads()
    const text = '😀'.repeat(MAX_COPILOT_REQUEST_BYTES / 4)
    draft =
      field === 'text'
        ? { ...draft, text }
        : { ...draft, contexts: [{ kind: 'docs', label: text }] }
    await act(async () => root.render(<Harness />))
    let reading!: Promise<void>
    act(() => {
      reading = state.processFiles(files('small.png'))
    })
    await act(async () => {
      readers.forEach((reader) => reader.finish())
      await reading
    })
    expect(readers).toHaveLength(0)
    expect(preview).not.toHaveBeenCalled()
    expect(state.attachedFiles.length).toBe(0)
    expect(state.uploadError).toContain('10 MiB')
  }
)

it.each(['text', 'contexts'] as const)(
  'rechecks the latest %s draft after reading an image',
  async (field) => {
    const readers = controlledReads()
    let reading!: Promise<void>
    act(() => {
      reading = state.processFiles(files('small.png'))
    })
    const text = 'x'.repeat(MAX_COPILOT_REQUEST_BYTES)
    draft =
      field === 'text'
        ? { ...draft, text }
        : { ...draft, contexts: [{ kind: 'docs', label: text }] }
    await act(async () => root.render(<Harness />))
    await act(async () => {
      readers[0].finish()
      await reading
    })
    expect(state.attachedFiles.length).toBe(0)
    expect(state.uploadError).toContain('10 MiB')
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:small.png')
  }
)

it('releases reserved bytes on removal without restoring an image whose read finishes later', async () => {
  const readers = controlledReads()
  let first!: Promise<void>
  let second!: Promise<void>
  act(() => {
    first = state.processFiles(files(image('first.png', 4 * 1024 * 1024)))
  })
  act(() => state.removeFile(state.attachedFiles[0].id))
  act(() => {
    second = state.processFiles(files(image('second.png', 4 * 1024 * 1024)))
  })
  await act(async () => {
    readers.forEach((reader) => reader.finish())
    await Promise.all([first, second])
  })
  expect(readers).toHaveLength(2)
  expect(state.attachedFiles.map((file) => file.name)).toEqual(['second.png'])
  expect(state.uploadError).toBeNull()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first.png')
})

it('checks the actual encoded data before completing the attachment', async () => {
  const readers = controlledReads()
  let reading!: Promise<void>
  act(() => {
    reading = state.processFiles(files('small.png'))
  })
  await act(async () => {
    readers[0].finish(`data:image/png;base64,${'A'.repeat(MAX_COPILOT_REQUEST_BYTES)}`)
    await reading
  })
  expect(state.attachedFiles.length).toBe(0)
  expect(state.uploadError).toContain('10 MiB')
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:small.png')
})
