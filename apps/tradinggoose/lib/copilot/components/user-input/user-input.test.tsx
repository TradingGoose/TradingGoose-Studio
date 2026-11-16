/** @vitest-environment jsdom */
import { act, type Dispatch, type SetStateAction, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CopilotDraft } from '@/stores/copilot/types'
import type { AttachedFile } from './types'

const mocked = vi.hoisted(() => ({
  files: [] as AttachedFile[],
  uploadError: null as string | null,
  clear: vi.fn(),
  change: vi.fn(),
  submit: vi.fn(),
}))
vi.mock('@/components/ui', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    Textarea: React.forwardRef<HTMLTextAreaElement, any>((props, ref) => (
      <textarea {...props} ref={ref} />
    )),
    Tooltip: ({ children }: any) => children,
    TooltipContent: () => null,
    TooltipTrigger: ({ render }: any) => render,
  }
})
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'actor' } } }) }))
vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector: (state: any) => unknown) => selector({ accessLevel: 'limited' }),
}))
vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useCopilotMessages: () => ({
    input: {
      attachFile: 'Attach image',
      insertMention: 'Mention',
      sendMessage: 'Send',
      placeholderLimited: 'Draft',
      placeholderFull: 'Draft',
      stopGeneration: 'Stop',
    },
  }),
}))
vi.mock('./hooks/use-user-input-attachments', () => ({
  useUserInputAttachments: () => ({
    attachedFiles: mocked.files,
    uploadError: mocked.uploadError,
    clearAttachedFiles: mocked.clear,
    processFiles: vi.fn(),
    removeFile: vi.fn(),
  }),
}))
vi.mock('./hooks/use-user-input-mention-sources', () => ({
  useUserInputMentionSources: () => ({
    mentionSources: {},
    mentionFailed: {},
    mentionLoading: {},
    ensureSubmenuLoaded: vi.fn(),
  }),
}))
vi.mock('./hooks/use-user-input-mentions', () => ({
  useUserInputMentions: ({ draft }: any) => ({
    selectedContexts: draft.contexts,
    mentionRanges: [],
    closeMentionMenu: vi.fn(),
    handleKeyDown: () => false,
  }),
}))
vi.mock('./components/mention-menu', () => ({ MentionMenu: () => null }))
vi.mock('./components/access-level-selector', () => ({ AccessLevelSelector: () => null }))
vi.mock('./components/model-selector', () => ({ ModelSelector: () => null }))
vi.mock('./components/attached-files-grid', () => ({
  AttachedFilesGrid: ({ attachedFiles }: any) => (
    <div data-testid='files'>{attachedFiles.map((file: AttachedFile) => file.name).join(',')}</div>
  ),
}))

import { UserInput } from './user-input'

let root: Root
let container: HTMLDivElement
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const descriptor: AttachedFile = {
  id: 'image',
  name: 'retained.png',
  size: 10,
  type: 'image/png',
  data: 'data:image/png;base64,aW1hZ2U=',
  uploading: false,
}
let currentDraft: CopilotDraft
let updateDraft: Dispatch<SetStateAction<CopilotDraft>>
function Harness({
  clear = true,
  submitDisabled = false,
  isLoading = false,
}: {
  clear?: boolean
  submitDisabled?: boolean
  isLoading?: boolean
}) {
  const [draft, setDraft] = useState<CopilotDraft>({ text: 'Preserved draft', contexts: [] })
  currentDraft = draft
  updateDraft = setDraft
  return (
    <UserInput
      workspaceId='workspace'
      onSubmit={mocked.submit}
      onAbort={vi.fn()}
      isLoading={isLoading}
      clearOnSubmit={clear}
      submitDisabled={submitDisabled}
      draft={draft}
      onDraftChange={(update) => {
        mocked.change(update)
        setDraft(update)
      }}
      panelWidth={375}
    />
  )
}
const render = (clear = true) => act(async () => root.render(<Harness clear={clear} />))
const submit = () =>
  act(async () => (container.querySelector('[aria-label="Send"]') as HTMLButtonElement).click())
beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocked.files = [descriptor]
  mocked.uploadError = null
  vi.clearAllMocks()
  mocked.clear.mockImplementation((submittedIds: string[]) => {
    mocked.files = mocked.files.filter((file) => !submittedIds.includes(file.id))
  })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
})
it('shows the authenticated upload failure as an actionable error while retaining draft and files', async () => {
  mocked.uploadError = 'Upload authorization expired. Upload this file again.'
  await render()
  expect(container.querySelector('[role="alert"]')).toHaveTextContent(mocked.uploadError)
  expect(container.querySelector('textarea')).toHaveValue('Preserved draft')
  expect(container.textContent).toContain('retained.png')
})
it('keeps composing available but refuses click and Enter submission without a configured model', async () => {
  await act(async () => root.render(<Harness submitDisabled />))
  expect(container.querySelector('[aria-label="Send"]')).toBeDisabled()
  const textarea = container.querySelector('textarea')!
  expect(textarea).not.toBeDisabled()
  await submit()
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
  })
  expect(mocked.submit).not.toHaveBeenCalled()
  expect(currentDraft.text).toBe('Preserved draft')
  expect(mocked.clear).not.toHaveBeenCalled()
})
it('retains draft and attachments when native image delivery is blocked before contact', async () => {
  mocked.submit.mockResolvedValue(false)
  await render()
  const submittedDraft = currentDraft
  await submit()
  expect(mocked.submit).toHaveBeenCalledWith(
    'Preserved draft',
    [
      {
        type: 'image',
        image: descriptor.data,
        mediaType: descriptor.type,
      },
    ],
    [],
    expect.any(Function)
  )
  expect(mocked.clear).not.toHaveBeenCalled()
  expect(mocked.change).not.toHaveBeenCalled()
  expect(currentDraft).toBe(submittedDraft)
  expect(mocked.files.map((file) => file.id)).toEqual([descriptor.id])
})
it.each([false, true])(
  'clears accepted input while streaming and preserves the next draft after result %s',
  async (completed) => {
    const pending = heldSubmission()
    await render()
    await act(async () =>
      updateDraft({
        text: 'Preserved draft',
        contexts: [{ kind: 'workflow', workflowId: 'workflow', label: 'Workflow' }],
      })
    )
    await submit()
    await act(async () => root.render(<Harness isLoading />))
    expect(container.querySelector('textarea')).toHaveValue('Preserved draft')
    await pending.accept()
    expect(container.querySelector('[aria-label="Stop"]')).toBeEnabled()
    expect(container.querySelector('textarea')).toHaveValue('')
    expect(container.querySelector('pre')?.textContent?.trim()).toBe('')
    expect(container.querySelector('[data-testid="files"]')).toBeEmptyDOMElement()
    expect(currentDraft).toEqual({ text: '', contexts: [] })
    expect(mocked.clear).toHaveBeenCalledExactlyOnceWith([descriptor.id])

    await act(async () => updateDraft({ text: 'Next question', contexts: [] }))
    await pending.finish(completed)
    expect(container.querySelector('textarea')).toHaveValue('Next question')
    expect(container.querySelector('pre')).toHaveTextContent('Next question')
    expect(mocked.clear).toHaveBeenCalledOnce()
  }
)
it('refuses missing image bytes before calling the native send handler', async () => {
  mocked.files = [{ ...descriptor, data: undefined }]
  await render()
  await submit()
  expect(mocked.submit).not.toHaveBeenCalled()
  expect(mocked.clear).not.toHaveBeenCalled()
  expect(mocked.change).not.toHaveBeenCalled()
})

function heldSubmission() {
  let resolve!: (completed: boolean) => void
  let onAccepted!: () => void
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  mocked.submit.mockImplementation((_message, _images, _contexts, accepted: () => void) => {
    onAccepted = accepted
    return promise
  })
  return {
    accept: () => act(async () => onAccepted()),
    finish: (completed: boolean) => act(async () => resolve(completed)),
  }
}
it.each(['text', 'contexts', 'ABA'])(
  'preserves the later %s draft while selectively clearing submitted image IDs',
  async (kind) => {
    const pending = heldSubmission()
    await render()
    await submit()
    const submitted = currentDraft
    await act(async () => updateDraft({ ...submitted, text: 'new text' }))
    if (kind === 'contexts')
      await act(async () =>
        updateDraft({
          ...submitted,
          contexts: [{ kind: 'workflow', workflowId: 'new', label: 'New workflow' }],
        })
      )
    if (kind === 'ABA') await act(async () => updateDraft({ ...submitted }))
    const newer = currentDraft
    mocked.files = [...mocked.files, { ...descriptor, id: 'new-image' }]
    await pending.accept()
    await pending.finish(true)
    expect(currentDraft).toBe(newer)
    expect(mocked.clear).toHaveBeenCalledExactlyOnceWith([descriptor.id])
  }
)
it.each([false, true])(
  'clearOnSubmit:false leaves the edit draft/files after result %s',
  async (accepted) => {
    const pending = heldSubmission()
    await render(false)
    const submitted = currentDraft
    await submit()
    if (accepted) await pending.accept()
    await pending.finish(accepted)
    expect(currentDraft).toBe(submitted)
    expect(mocked.clear).not.toHaveBeenCalled()
  }
)
it('unmounted old composer cannot clear its submitted files after navigation', async () => {
  const pending = heldSubmission()
  await render()
  await submit()
  await act(async () => root.render(<div>new chat</div>))
  await pending.accept()
  await pending.finish(true)
  expect(mocked.clear).not.toHaveBeenCalled()
  expect(mocked.change).not.toHaveBeenCalled()
})
