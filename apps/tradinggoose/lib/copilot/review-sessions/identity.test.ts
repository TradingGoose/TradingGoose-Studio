/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildEntityListDescriptor,
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
  parseYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'

describe('review target identity helpers', () => {
  it('round-trips saved-entity transport envelopes through entityId', () => {
    const descriptor = {
      workspaceId: 'ws-1',
      entityKind: 'skill' as const,
      entityId: 'skill-1',
      ownerUserId: null,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'skill-1',
    }

    expect(buildReviewTargetDescriptorFromEnvelope(buildYjsTransportEnvelope(descriptor))).toEqual(
      descriptor
    )
  })

  it('treats workflow as an entity transport target', () => {
    const descriptor = {
      workspaceId: 'ws-1',
      entityKind: 'workflow' as const,
      entityId: 'workflow-1',
      ownerUserId: null,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'workflow-1',
    }

    const envelope = buildYjsTransportEnvelope(descriptor)
    expect(envelope).toEqual({
      targetKind: 'entity',
      sessionId: 'workflow-1',
      reviewSessionId: null,
      workspaceId: 'ws-1',
      ownerUserId: null,
      entityKind: 'workflow',
      entityId: 'workflow-1',
      draftSessionId: null,
    })
    expect(buildReviewTargetDescriptorFromEnvelope(envelope)).toEqual(descriptor)
  })

  it('round-trips canonical entity-list envelopes and rejects entity targets', () => {
    const descriptor = buildEntityListDescriptor('skill', 'ws-1')
    const envelope = buildYjsTransportEnvelope(descriptor)
    expect(envelope.targetKind).toBe('entity_list')
    expect(envelope.entityId).toBeNull()
    expect(envelope.sessionId).toBe('list:skill:ws-1')
    expect(buildReviewTargetDescriptorFromEnvelope(envelope)).toEqual(descriptor)
    const wire = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    expect(buildReviewTargetDescriptorFromEnvelope(parseYjsTransportEnvelope(wire))).toEqual(
      descriptor
    )
    expect(() =>
      buildReviewTargetDescriptorFromEnvelope({ ...envelope, entityId: 'skill-1' })
    ).toThrow(/cannot carry/)
  })
})
