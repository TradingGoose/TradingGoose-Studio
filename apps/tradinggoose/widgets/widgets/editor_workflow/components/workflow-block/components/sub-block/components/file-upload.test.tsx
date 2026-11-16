/** @vitest-environment jsdom */
import { act, type ReactNode, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileUpload } from './file-upload'

type SelectedFile = { name: string; path: string; key?: string; size: number; type: string }
let selected: SelectedFile | SelectedFile[] | null = null
const listeners = new Set<() => void>()
const m = vi.hoisted(() => ({ persist: vi.fn(), fetch: vi.fn(), parentClick: vi.fn() }))
vi.mock('next-intl', () => ({ useLocale: () => 'en' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({
    fileUpload: {
      uploadFailed: 'Upload failed',
      uploading: 'Uploading',
      uploadComplete: 'Upload complete',
    },
  }),
}))
vi.mock('@/i18n/block-editor', () => ({
  translateWorkflowLabel: (_locale: string, label: string) => label,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowId: () => 'workflow',
  useWorkspaceId: () => 'workspace',
}))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useBlock: () => ({ type: 'file-parser' }),
  useSubBlockValue: (_blockId: string, field: string) =>
    useSyncExternalStore(
      (notify) => {
        listeners.add(notify)
        return () => listeners.delete(notify)
      },
      () => (field === 'files' ? selected : null)
    ),
}))
vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({ collaborativeSetSubblockValue: m.persist }),
}))
vi.mock('@/stores/model-registry', () => ({
  useModelRegistry: () => [],
  getModelProvider: vi.fn(),
}))
vi.mock('@/components/ui', () => {
  const Group = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    Command: Group,
    CommandEmpty: Group,
    CommandGroup: Group,
    CommandInput: () => null,
    CommandItem: Group,
    CommandList: Group,
    Popover: Group,
    PopoverContent: () => null,
    PopoverTrigger: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
  }
})
let container: HTMLDivElement
let root: Root
function value(path: string, name = 'selected.txt'): SelectedFile {
  return { name, path, size: 32, type: 'text/plain' }
}
beforeEach(() => {
  vi.resetAllMocks()
  selected = null
  listeners.clear()
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
    writable: true,
  })
  m.persist.mockImplementation(
    (_blockId: string, field: string, next: SelectedFile | SelectedFile[] | null) => {
      expect(field).toBe('files')
      selected = next
      for (const notify of listeners) notify()
    }
  )
  m.fetch.mockImplementation(async () => Response.json({ success: true }))
  vi.stubGlobal('fetch', m.fetch)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  listeners.clear()
  vi.unstubAllGlobals()
})
async function render(options: { multiple?: boolean; disabled?: boolean } = {}) {
  await act(async () =>
    root.render(
      <div onClick={m.parentClick}>
        <FileUpload blockId='block' subBlockId='files' {...options} />
      </div>
    )
  )
}
function removalButtons() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
    button.querySelector('svg.lucide-x')
  )
}
async function remove(index = 0) {
  await act(async () => removalButtons()[index]!.click())
}
const sources = [
  'flat-source.txt',
  '/api/files/serve/s3/copilot%2Fprivate.png?context=general',
  '/api/files/serve/s3/workspace%2Fexisting.txt?context=workspace&workspaceId=workspace&fileId=canonical',
  'https://private-source.s3.amazonaws.com/raw.txt',
  '%E0%A4%A',
  'not-a-percent-%-path',
]
describe('FileUpload actual selection removal', () => {
  it.each(sources)(
    'single reference %s is deselected through existing Yjs hook with zero storage requests',
    async (path) => {
      selected = value(path)
      await render()
      expect(removalButtons()).toHaveLength(1)
      await remove()
      expect(m.persist).toHaveBeenCalledExactlyOnceWith('block', 'files', null)
      expect(selected).toBeNull()
      expect(m.fetch).not.toHaveBeenCalled()
      expect(removalButtons()).toHaveLength(0)
      expect(m.parentClick).not.toHaveBeenCalled()
    }
  )
  it('multiple selection removes only the chosen reference, retains exact remaining payload, then clears the final selection', async () => {
    const retained = value(
      '/api/files/serve/s3/workspace%2Fretained.txt?context=workspace',
      'retained.txt'
    )
    selected = [value('%E0%A4%A', 'remove.txt'), retained]
    await render({ multiple: true })
    await remove()
    expect(m.persist).toHaveBeenLastCalledWith('block', 'files', [retained])
    expect(selected).toEqual([retained])
    expect(container.textContent).not.toContain('remove.txt')
    await remove()
    expect(m.persist).toHaveBeenLastCalledWith('block', 'files', null)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'disabled/preview single-or-multiple=%s cannot mutate selection or contact storage',
    async (multiple) => {
      const file = value('protected-existing.txt')
      selected = multiple ? [file] : file
      await render({ multiple, disabled: true })
      const button = removalButtons()[0]!
      expect(button.disabled).toBe(true)
      await remove()
      expect(m.persist).not.toHaveBeenCalled()
      expect(m.fetch).not.toHaveBeenCalled()
      expect(selected).toEqual(multiple ? [file] : file)
    }
  )
})
