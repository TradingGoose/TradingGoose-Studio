/**
 * @vitest-environment jsdom
 */

import type { MutableRefObject } from 'react'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'

const mockRenameSavedEntityAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/saved-entities/actions', () => ({
  renameSavedEntityAction: (...args: unknown[]) => mockRenameSavedEntityAction(...args),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('SkillEditor save', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mockRenameSavedEntityAction.mockResolvedValue(undefined)
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renames the identity and saves content through their canonical owners', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const exportRef = createRef<() => void>()
    const saveRef = createRef<() => void>()
    const doc = new Y.Doc()
    const initialValues = {
      description: 'Investigate the market.',
      content: 'Use multiple trusted sources.',
    }
    saveRef.current = () => {}
    seedEntitySession(doc, { entityKind: 'skill', payload: initialValues })

    await act(async () => {
      root.render(
        <SkillEditor
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
          skillId='skill-1'
          workspaceId='workspace-1'
          entityName='Market Research'
          doc={doc}
          save={save}
        />
      )
    })

    const nameInput = container.querySelector('#skill-editor-name') as HTMLInputElement | null
    expect(nameInput).toBeTruthy()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(nameInput, 'Market Research Updated')
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      nameInput!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      saveRef.current?.()
    })

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(mockRenameSavedEntityAction).toHaveBeenCalledWith({
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'Market Research Updated',
    })
    doc.destroy()
  })
})
