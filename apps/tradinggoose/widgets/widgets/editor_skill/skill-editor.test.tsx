/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import { SKILL_EDITOR_ACTION_EVENT, type SkillEditorActionEventDetail } from '@/widgets/events'
import { emitEditorAction } from '@/widgets/utils/editor-actions'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('SkillEditor save', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('saves identity and content through one session mutation', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const doc = new Y.Doc()
    const initialValues = {
      description: 'Investigate the market.',
      content: 'Use multiple trusted sources.',
    }
    seedEntitySession(doc, { entityKind: 'skill', payload: initialValues })

    await act(async () => {
      root.render(
        <SkillEditor
          skillId='skill-1'
          entityName='Market Research'
          doc={doc}
          save={save}
          panelId='panel-1'
          widgetKey='editor_skill'
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
      emitEditorAction<SkillEditorActionEventDetail>(SKILL_EDITOR_ACTION_EVENT, {
        action: 'save',
        entityId: 'skill-1',
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith('Market Research Updated')
    doc.destroy()
  })

  it('makes retained writer callbacks harmless after a read-only downgrade', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'skill',
      payload: { description: 'Original description', content: 'Original content' },
    })
    const renderEditor = (readOnly: boolean) => (
      <SkillEditor
        skillId='skill-1'
        entityName='Market Research'
        doc={doc}
        save={save}
        panelId='panel-1'
        widgetKey='editor_skill'
        readOnly={readOnly}
      />
    )

    await act(async () => root.render(renderEditor(false)))
    const nameInput = container.querySelector('#skill-editor-name') as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(nameInput, 'Forbidden Rename')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      nameInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => root.render(renderEditor(true)))
    const descriptionInput = container.querySelector(
      '#skill-editor-description'
    ) as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(descriptionInput, 'Forbidden description')
      descriptionInput.dispatchEvent(new Event('input', { bubbles: true }))
      descriptionInput.dispatchEvent(new Event('change', { bubbles: true }))
      emitEditorAction<SkillEditorActionEventDetail>(SKILL_EDITOR_ACTION_EVENT, {
        action: 'save',
        entityId: 'skill-1',
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    expect(String(doc.getMap('fields').get('description'))).toBe('Original description')
    expect(save).not.toHaveBeenCalled()
    doc.destroy()
  })
})
