import { describe, expect, it } from 'vitest'
import { buildPreviewDiffStatusMap, getPreviewDiffClasses } from './preview-diff'

describe('preview diff helpers', () => {
  it('maps add to new and edit-like operations to edited with new taking precedence', () => {
    const statuses = buildPreviewDiffStatusMap([
      { operation_type: 'edit', block_id: 'block-1' },
      { operation_type: 'add', block_id: 'block-2' },
      { operation_type: 'edit', block_id: 'block-2' },
      { operation_type: 'insert_into_subflow', block_id: 'block-3' },
      { operation_type: 'extract_from_subflow', block_id: 'block-4' },
      { operation_type: 'delete', block_id: 'block-5' },
    ])

    expect(statuses.get('block-1')).toBe('edited')
    expect(statuses.get('block-2')).toBe('new')
    expect(statuses.get('block-3')).toBe('edited')
    expect(statuses.get('block-4')).toBe('edited')
    expect(statuses.has('block-5')).toBe(false)
  })

  it('returns the canonical outline classes for preview diff statuses', () => {
    expect(getPreviewDiffClasses('new')).toContain('ring-green-500')
    expect(getPreviewDiffClasses('edited')).toContain('ring-orange-500')
    expect(getPreviewDiffClasses()).toBe('')
  })
})
