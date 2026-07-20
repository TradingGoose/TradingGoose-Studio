/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { emitEditorAction, useEditorActions } from './editor-actions'

const TEST_EVENT = 'editor-actions:test'
type TestActionDetail = {
  action: 'save'
  entityId: string
  panelId?: string
  widgetKey?: string
}

function ActionOwner({ entityId, save }: { entityId: string; save: () => void }) {
  useEditorActions<TestActionDetail>(TEST_EVENT, {
    entityId,
    panelId: 'panel-1',
    widgetKey: 'editor_test',
    save,
  })
  return null
}

it('routes actions only to the matching mounted entity owner', async () => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  const saveA = vi.fn()
  const saveB = vi.fn()
  const emitSave = (entityId: string) =>
    emitEditorAction<TestActionDetail>(TEST_EVENT, {
      action: 'save',
      entityId,
      panelId: 'panel-1',
      widgetKey: 'editor_test',
    })

  await act(async () => root.render(<ActionOwner entityId='entity-a' save={saveA} />))
  act(() => emitSave('entity-a'))
  expect(saveA).toHaveBeenCalledOnce()

  await act(async () => root.render(<ActionOwner entityId='entity-b' save={saveB} />))
  act(() => emitSave('entity-a'))
  expect(saveB).not.toHaveBeenCalled()
  act(() => emitSave('entity-b'))
  expect(saveB).toHaveBeenCalledOnce()

  await act(async () => root.unmount())
  act(() => emitSave('entity-b'))
  expect(saveB).toHaveBeenCalledOnce()
})
