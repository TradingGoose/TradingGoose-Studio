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

  it('preserves entity and review context when the workflow changes', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      reviewTarget: {
        reviewSessionId: 'chat-a',
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
      reviewTarget: {
        reviewSessionId: 'chat-a',
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
      channelId: 'pair-blue',
    })
  })

  it('preserves explicitly supplied replacement targets on a workflow change', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      skillId: 'skill-a',
    })

    setContext('blue', {
      workflowId: 'workflow-b',
      skillId: 'skill-b',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      workflowId: 'workflow-b',
      skillId: 'skill-b',
    })
  })

  it('keeps review state separate while preserving parallel current entities', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      reviewTarget: {
        reviewSessionId: 'chat-a',
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
    })

    setContext('blue', {
      indicatorId: 'indicator-b',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      reviewTarget: {
        reviewSessionId: 'chat-a',
      },
      skillId: 'skill-a',
      customToolId: 'tool-a',
      indicatorId: 'indicator-b',
    })
  })
})
