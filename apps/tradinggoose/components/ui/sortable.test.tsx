import type { Announcements, DndContextProps } from '@dnd-kit/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ announcements: null as Announcements | null }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()

  return {
    ...actual,
    DndContext: ({ accessibility }: DndContextProps) => {
      captured.announcements = accessibility?.announcements ?? null
      return null
    },
  }
})

import { Sortable } from '@/components/ui/sortable'

describe('Sortable', () => {
  it('derives announcement positions from its items when event metadata is empty', () => {
    renderToStaticMarkup(<Sortable value={['first', 'second']} />)

    const announcements = captured.announcements
    expect(announcements).not.toBeNull()
    if (!announcements) return

    const active = { id: 'second', data: { current: {} } }
    const over = { id: 'first', data: { current: {} } }

    expect([
      announcements.onDragStart({ active } as never),
      announcements.onDragOver({ active, over } as never),
      announcements.onDragMove?.({ active, over } as never),
      announcements.onDragEnd({ active, over } as never),
      announcements.onDragCancel({ active, over: null } as never),
    ]).toEqual([
      'Grabbed sortable item "second". Current position is 2 of 2. Use arrow keys to move, space to drop.',
      'Sortable item "second" moved up to position 1 of 2.',
      'Sortable item "second" is moving up to position 1 of 2.',
      'Sortable item "second" dropped at position 1 of 2.',
      'Sorting cancelled. Sortable item "second" returned to position 2 of 2.',
    ])
  })
})
