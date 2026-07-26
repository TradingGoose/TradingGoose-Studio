/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildDashboardColorPairDescriptor,
  buildDashboardWidgetDescriptor,
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

  it('round-trips independent dashboard child documents without making them entities', () => {
    const widget = buildDashboardWidgetDescriptor({
      layoutId: 'layout-1',
      identityId: 'widget-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
    })
    const pair = buildDashboardColorPairDescriptor({
      layoutId: 'layout-1',
      color: 'red',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
    })

    expect(widget.yjsSessionId).toBe('dashboard-widget:layout-1:widget-1')
    expect(pair.yjsSessionId).toBe('dashboard-color-pair:layout-1:red')
    expect(buildReviewTargetDescriptorFromEnvelope(buildYjsTransportEnvelope(widget))).toEqual(
      widget
    )
    expect(buildReviewTargetDescriptorFromEnvelope(buildYjsTransportEnvelope(pair))).toEqual(pair)
  })

  it('rejects dashboard child kinds from entity-list transport', () => {
    const widget = buildDashboardWidgetDescriptor({
      layoutId: 'layout-1',
      identityId: 'widget-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
    })
    const envelope = buildYjsTransportEnvelope(widget)

    expect(() =>
      buildReviewTargetDescriptorFromEnvelope({
        ...envelope,
        targetKind: 'entity_list',
        entityId: null,
        sessionId: 'list:dashboard_widget:ws-1:user:user-1',
      })
    ).toThrow('Invalid or missing review entity kind')
  })
})
