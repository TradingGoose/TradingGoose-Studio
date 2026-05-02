import { describe, expect, it } from 'vitest'
import {
  readEntitySelectionState,
  readReviewTargetDescriptor,
} from './review-target-utils'

describe('review target utils', () => {
  it('ignores persisted params when linked pair context is present', () => {
    expect(
      readEntitySelectionState({
        pairContext: {
          workflowId: 'workflow-1',
        },
        params: {
          indicatorId: 'indicator-1',
          reviewSessionId: 'review-1',
          reviewEntityKind: 'indicator',
          reviewEntityId: 'indicator-1',
          workspaceId: 'workspace-1',
          yjsSessionId: 'yjs-1',
        },
        legacyIdKey: 'indicatorId',
      })
    ).toEqual({
      legacyEntityId: null,
      reviewSessionId: null,
      reviewEntityId: null,
      reviewDraftSessionId: null,
      descriptor: null,
    })
  })

  it('reads review target descriptor from widget params in gray mode', () => {
    expect(
      readReviewTargetDescriptor({
        params: {
          reviewSessionId: 'review-param',
          reviewEntityKind: 'indicator',
          reviewEntityId: 'indicator-param',
          workspaceId: 'workspace-1',
        },
      })
    ).toMatchObject({
      entityKind: 'indicator',
      entityId: 'indicator-param',
      reviewSessionId: 'review-param',
    })
  })
})
