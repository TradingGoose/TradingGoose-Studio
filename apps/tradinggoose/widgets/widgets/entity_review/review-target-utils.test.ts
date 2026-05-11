import { describe, expect, it } from 'vitest'
import {
  buildPersistedPairContext,
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
        entityIdKey: 'indicatorId',
      })
    ).toEqual({
      selectedEntityId: null,
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

  it('reads canonical review target fields from linked pair context', () => {
    expect(
      readEntitySelectionState({
        pairContext: {
          reviewSessionId: 'review-pair',
          reviewEntityKind: 'skill',
          reviewEntityId: null,
          reviewDraftSessionId: 'draft-pair',
        },
        params: {
          skillId: 'stale-param-skill',
        },
        entityIdKey: 'skillId',
      })
    ).toMatchObject({
      selectedEntityId: null,
      reviewSessionId: 'review-pair',
      reviewEntityId: null,
      reviewDraftSessionId: 'draft-pair',
      descriptor: {
        entityKind: 'skill',
        entityId: null,
        reviewSessionId: 'review-pair',
        draftSessionId: 'draft-pair',
      },
    })
  })

  it('persists canonical review target fields into pair context', () => {
    expect(
      buildPersistedPairContext({
        existing: {
          skillId: 'skill-old',
          reviewSessionId: 'review-old',
          reviewEntityKind: 'skill',
        },
        entityIdKey: 'skillId',
        selectedEntityId: null,
        descriptor: {
          workspaceId: 'workspace-1',
          entityKind: 'skill',
          entityId: null,
          draftSessionId: 'draft-next',
          reviewSessionId: 'review-next',
          yjsSessionId: 'review-next',
        },
      })
    ).toEqual({
      reviewEntityKind: 'skill',
      reviewSessionId: 'review-next',
      reviewDraftSessionId: 'draft-next',
    })
  })
})
