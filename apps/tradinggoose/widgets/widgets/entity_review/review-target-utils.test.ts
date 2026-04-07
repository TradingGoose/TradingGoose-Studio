import { describe, expect, it } from 'vitest'
import {
  readEntitySelectionState,
  readReviewTargetDescriptor,
} from './review-target-utils'

describe('review target utils', () => {
  it('falls back to persisted params when pair context only contains workflow state', () => {
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
    ).toMatchObject({
      legacyEntityId: 'indicator-1',
      reviewSessionId: 'review-1',
      reviewEntityId: 'indicator-1',
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'indicator',
        entityId: 'indicator-1',
        reviewSessionId: 'review-1',
        yjsSessionId: 'review-1',
      },
    })
  })

  it('prefers explicit pair review target fields when they are present', () => {
    expect(
      readReviewTargetDescriptor({
        pairContext: {
          workflowId: 'workflow-1',
          reviewTarget: {
            reviewSessionId: 'review-pair',
            reviewEntityKind: 'indicator',
            reviewEntityId: 'indicator-pair',
          },
        },
        params: {
          reviewSessionId: 'review-param',
          reviewEntityKind: 'indicator',
          reviewEntityId: 'indicator-param',
          workspaceId: 'workspace-1',
        },
      })
    ).toMatchObject({
      entityKind: 'indicator',
      entityId: 'indicator-pair',
      reviewSessionId: 'review-pair',
    })
  })
})
