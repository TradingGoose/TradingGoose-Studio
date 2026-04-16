import { beforeEach, describe, expect, it } from 'vitest'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { type PairColor, PAIR_COLORS } from '@/widgets/pair-colors'

function resetPairContexts() {
  usePairColorStore.setState({
    contexts: Object.fromEntries(PAIR_COLORS.map((color) => [color, {}])) as Record<PairColor, PairColorContext>,
  })
}

describe('pair-store linked context', () => {
  beforeEach(() => {
    resetPairContexts()
  })

  it('ignores unsupported legacy keys instead of migrating them', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      channelId: 'pair-blue',
      copilotChatId: 'legacy-review-session',
    } as PairColorContext & { copilotChatId?: string })

    const context = usePairColorStore.getState().contexts.blue as PairColorContext & {
      copilotChatId?: string
    }

    expect(context).toMatchObject({
      workflowId: 'workflow-a',
      channelId: 'pair-blue',
    })
    expect(context.reviewTarget).toBeUndefined()
    expect(context.copilotChatId).toBeUndefined()
  })

  it('preserves explicit review target when the ambient workflow changes without a replacement target', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      reviewTarget: {
        reviewSessionId: 'review-a',
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-a',
        reviewDraftSessionId: null,
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
      channelId: 'pair-blue',
    })

    setContext('blue', {
      workflowId: 'workflow-b',
      channelId: 'pair-blue',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      workflowId: 'workflow-b',
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
      channelId: 'pair-blue',
      reviewTarget: {
        reviewSessionId: 'review-a',
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-a',
        reviewDraftSessionId: null,
      },
    })
  })

  it('preserves explicitly supplied replacement targets on an entity change', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      reviewTarget: {
        reviewSessionId: 'review-a',
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-a',
        reviewDraftSessionId: null,
      },
    })

    setContext('blue', {
      workflowId: 'workflow-b',
      reviewTarget: {
        reviewSessionId: 'review-b',
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-b',
        reviewDraftSessionId: null,
      },
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      workflowId: 'workflow-b',
      reviewTarget: {
        reviewSessionId: 'review-b',
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-b',
        reviewDraftSessionId: null,
      },
    })
  })

  it('preserves explicitly supplied review targets that match the existing entity id', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      skillId: 'skill-a',
    })

    setContext('blue', {
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      skillId: 'skill-a',
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
    })
  })

  it('keeps review state separate from other entity kinds', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
    })

    setContext('blue', {
      indicatorId: 'indicator-b',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
      indicatorId: 'indicator-b',
    })
  })

  it('preserves explicit review target when the same ambient entity kind changes', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
      skillId: 'skill-a',
    })

    setContext('blue', {
      skillId: 'skill-b',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      skillId: 'skill-b',
      reviewTarget: {
        reviewSessionId: 'review-skill-a',
        reviewEntityKind: 'skill',
        reviewEntityId: 'skill-a',
        reviewDraftSessionId: null,
      },
    })
  })

  it('preserves explicit draft review target when an ambient saved entity id is selected', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      reviewTarget: {
        reviewSessionId: 'review-draft-skill',
        reviewEntityKind: 'skill',
        reviewEntityId: null,
        reviewDraftSessionId: 'draft-skill',
      },
      skillId: null,
    })

    setContext('blue', {
      skillId: 'skill-saved',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      skillId: 'skill-saved',
      reviewTarget: {
        reviewSessionId: 'review-draft-skill',
        reviewEntityKind: 'skill',
        reviewEntityId: null,
        reviewDraftSessionId: 'draft-skill',
      },
    })
  })
})
