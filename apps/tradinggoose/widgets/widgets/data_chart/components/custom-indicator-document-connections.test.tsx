/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getFieldsMap } from '@/lib/yjs/entity-session'
import { CustomIndicatorDocumentConnections } from './custom-indicator-document-connections'

const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/use-entity-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/yjs/use-entity-fields')>()),
  useSavedEntityYjsSession: mockUseSavedEntityYjsSession,
}))

function createIndicatorDoc(pineCode: string) {
  const doc = new Y.Doc()
  const code = new Y.Text()
  code.insert(0, pineCode)
  getFieldsMap(doc).set('pineCode', code)
  return { doc, code }
}

describe('CustomIndicatorDocumentConnections', () => {
  let container: HTMLDivElement
  let root: Root
  let custom: ReturnType<typeof createIndicatorDoc>

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    custom = createIndicatorDoc("indicator('Custom')\ninput.int(14, 'Length')")
    mockUseSavedEntityYjsSession.mockImplementation(
      (_kind, entityId: string, _workspaceId, _ownerUserId, accessMode) => ({
        doc: entityId === 'custom-1' ? custom.doc : null,
        save: vi.fn(),
        isLoading: false,
        error: null,
        accessMode,
      })
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    custom.doc.destroy()
    container.remove()
    mockUseSavedEntityYjsSession.mockReset()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })

  it('connects selected custom entities in read mode and publishes live Pine changes', async () => {
    const onChange = vi.fn()
    const members = [{ entityId: 'custom-1', entityName: 'Custom Indicator' }]

    await act(async () => {
      root.render(
        <CustomIndicatorDocumentConnections
          workspaceId='workspace-1'
          indicatorIds={['custom-1', 'relative-strength-index']}
          members={members}
          onChange={onChange}
        />
      )
    })

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      'indicator',
      'custom-1',
      'workspace-1',
      null,
      'read'
    )
    expect(mockUseSavedEntityYjsSession.mock.calls.every((call) => call[1] === 'custom-1')).toBe(
      true
    )
    expect(onChange).toHaveBeenLastCalledWith(
      'workspace-1:custom-1',
      expect.objectContaining({
        id: 'custom-1',
        pineCode: expect.stringContaining("input.int(14, 'Length')"),
        inputMeta: expect.objectContaining({ Length: expect.any(Object) }),
      })
    )
    expect(Object.keys(onChange.mock.calls.at(-1)?.[1] ?? {}).sort()).toEqual([
      'id',
      'inputMeta',
      'pineCode',
    ])

    await act(async () => {
      custom.code.delete(0, custom.code.length)
      custom.code.insert(0, "indicator('Updated')\ninput.float(2.5, 'Factor')")
    })
    expect(onChange).toHaveBeenLastCalledWith(
      'workspace-1:custom-1',
      expect.objectContaining({
        pineCode: expect.stringContaining("input.float(2.5, 'Factor')"),
        inputMeta: expect.objectContaining({ Factor: expect.any(Object) }),
      })
    )

    await act(async () => {
      custom.code.delete(0, custom.code.length)
    })
    expect(onChange).toHaveBeenLastCalledWith('workspace-1:custom-1', {
      id: 'custom-1',
      pineCode: '',
      inputMeta: undefined,
    })

    await act(async () => {
      root.render(
        <CustomIndicatorDocumentConnections
          workspaceId='workspace-1'
          indicatorIds={['relative-strength-index']}
          members={members}
          onChange={onChange}
        />
      )
    })
    expect(onChange).toHaveBeenLastCalledWith('workspace-1:custom-1', null)

    await act(async () => {
      root.render(
        <CustomIndicatorDocumentConnections
          workspaceId='workspace-2'
          indicatorIds={['custom-1']}
          members={members}
          onChange={onChange}
        />
      )
    })
    expect(mockUseSavedEntityYjsSession).toHaveBeenLastCalledWith(
      'indicator',
      'custom-1',
      'workspace-2',
      null,
      'read'
    )
    expect(onChange).toHaveBeenLastCalledWith(
      'workspace-2:custom-1',
      expect.objectContaining({ id: 'custom-1' })
    )
  })
})
