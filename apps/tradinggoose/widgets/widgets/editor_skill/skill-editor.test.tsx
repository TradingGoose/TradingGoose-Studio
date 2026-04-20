/**
 * @vitest-environment jsdom
 */

import type { MutableRefObject } from 'react'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'

const mockUseUpdateSkill = vi.fn()

vi.mock('@/hooks/queries/skills', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/skills')
  return {
    ...actual,
    useUpdateSkill: () => mockUseUpdateSkill(),
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('SkillEditor dirty state', () => {
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

  it('returns to a clean state after a successful save', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    const onDirtyChange = vi.fn()
    const saveRef = createRef<() => void>()
    saveRef.current = () => {}

    mockUseUpdateSkill.mockReturnValue({
      isPending: false,
      mutateAsync,
    })

    await act(async () => {
      root.render(
        <SkillEditor
          workspaceId='workspace-1'
          saveRef={saveRef as MutableRefObject<() => void>}
          onDirtyChange={onDirtyChange}
          initialValues={{
            id: 'skill-1',
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Use multiple trusted sources.',
          }}
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

    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      saveRef.current?.()
      await Promise.resolve()
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      skillId: 'skill-1',
      updates: {
        name: 'Market Research Updated',
        description: 'Investigate the market.',
        content: 'Use multiple trusted sources.',
      },
    })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})
