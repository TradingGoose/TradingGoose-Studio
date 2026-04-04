/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildReviewTargetDescriptor,
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
  deriveYjsSessionId,
  parseReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/identity'

describe('review target identity helpers', () => {
  it('uses workflowId as the workflow yjs session id', () => {
    expect(
      deriveYjsSessionId({
        entityKind: 'workflow',
        entityId: 'workflow-1',
        reviewSessionId: null,
      })
    ).toBe('workflow-1')
  })

  it('uses reviewSessionId as the saved-entity yjs session id', () => {
    expect(
      deriveYjsSessionId({
        entityKind: 'skill',
        entityId: 'skill-1',
        reviewSessionId: 'review-1',
      })
    ).toBe('review-1')
  })

  it('builds saved-entity descriptors with a review-session scoped yjs session id', () => {
    expect(
      buildReviewTargetDescriptor({
        id: 'review-1',
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        model: 'gpt-5-fast',
      })
    ).toEqual({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: 'review-1',
      reviewModel: 'gpt-5-fast',
      yjsSessionId: 'review-1',
    })
  })

  it('round-trips saved-entity transport envelopes through reviewSessionId', () => {
    const descriptor = {
      workspaceId: 'ws-1',
      entityKind: 'skill' as const,
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: 'review-1',
      reviewModel: 'gpt-5-fast',
      yjsSessionId: 'review-1',
    }

    expect(buildReviewTargetDescriptorFromEnvelope(buildYjsTransportEnvelope(descriptor))).toEqual(
      descriptor
    )
  })

  it('canonicalizes stale serialized saved-entity yjs session ids back to reviewSessionId', () => {
    expect(
      parseReviewTargetDescriptor({
        workspaceId: 'ws-1',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-1',
        reviewSessionId: 'review-1',
        reviewModel: 'gpt-5-fast',
        yjsSessionId: 'skill-1',
      })
    ).toEqual({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: 'review-1',
      reviewModel: 'gpt-5-fast',
      yjsSessionId: 'review-1',
    })
  })
})
