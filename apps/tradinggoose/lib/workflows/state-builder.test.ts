import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorkflowStateForTemplate } from '@/lib/workflows/state-builder'

const mockGetRegisteredWorkflowSession = vi.fn()
const mockExtractPersistedStateFromDoc = vi.fn()

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: any[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  extractPersistedStateFromDoc: (...args: any[]) => mockExtractPersistedStateFromDoc(...args),
}))

describe('buildWorkflowStateForTemplate', () => {
  beforeEach(() => {
    mockGetRegisteredWorkflowSession.mockReset()
    mockExtractPersistedStateFromDoc.mockReset()
  })

  it('returns null when no live workflow session is registered', () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)

    expect(buildWorkflowStateForTemplate('wf-1')).toBeNull()
    expect(mockExtractPersistedStateFromDoc).not.toHaveBeenCalled()
  })

  it('extracts persisted state from the live workflow doc when ready', () => {
    const doc = { id: 'doc-1' }
    const persistedState = {
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: 123,
    }

    mockGetRegisteredWorkflowSession.mockReturnValue({ workflowId: 'wf-1', doc })
    mockExtractPersistedStateFromDoc.mockReturnValue(persistedState)

    expect(buildWorkflowStateForTemplate('wf-1')).toEqual(persistedState)
    expect(mockExtractPersistedStateFromDoc).toHaveBeenCalledWith(doc)
  })
})
