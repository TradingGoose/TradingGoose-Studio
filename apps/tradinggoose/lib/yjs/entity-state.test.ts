import { describe, expect, it } from 'vitest'
import { normalizeDashboardLayoutEntityFields } from '@/lib/yjs/entity-state'

describe('normalizeDashboardLayoutEntityFields', () => {
  it('rejects unsupported widget params instead of replacing them', () => {
    expect(() =>
      normalizeDashboardLayoutEntityFields({
        name: 'Layout',
        layout: {
          id: 'panel-1',
          type: 'panel',
          widget: {
            key: 'editor_workflow',
            pairColor: 'gray',
            params: { workflowId: 'workflow-1', listing: { listing_id: 'AAPL' } },
          },
        },
        colorPairs: { pairs: [] },
        isActive: true,
        sortOrder: 0,
      })
    ).toThrow('Widget "editor_workflow" does not support this field')
  })
})
