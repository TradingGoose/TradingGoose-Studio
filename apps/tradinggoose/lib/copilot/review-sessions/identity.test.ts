/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'

describe('review target identity helpers', () => {
  it('round-trips saved-entity transport envelopes through entityId', () => {
    const descriptor = {
      workspaceId: 'ws-1',
      entityKind: 'skill' as const,
      entityId: 'skill-1',
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'skill-1',
    }

    expect(buildReviewTargetDescriptorFromEnvelope(buildYjsTransportEnvelope(descriptor))).toEqual(
      descriptor
    )
  })
})
