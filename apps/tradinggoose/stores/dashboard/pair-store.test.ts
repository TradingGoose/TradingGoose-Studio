import { beforeEach, describe, expect, it } from 'vitest'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { type PairColor, PAIR_COLORS } from '@/widgets/pair-colors'

function resetPairContexts() {
  usePairColorStore.setState({
    contexts: Object.fromEntries(PAIR_COLORS.map((color) => [color, {}])) as Record<PairColor, PairColorContext>,
  })
}

describe('pair-store workflow scoped context', () => {
  beforeEach(() => {
    resetPairContexts()
  })

  it('clears stale target ids when the workflow changes', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      copilotChatId: 'chat-a',
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
      pineIndicatorId: 'pine-a',
      channelId: 'pair-blue',
    })

    setContext('blue', {
      workflowId: 'workflow-b',
      channelId: 'pair-blue',
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      workflowId: 'workflow-b',
      channelId: 'pair-blue',
    })
    expect(usePairColorStore.getState().contexts.blue.copilotChatId).toBeUndefined()
    expect(usePairColorStore.getState().contexts.blue.skillId).toBeUndefined()
    expect(usePairColorStore.getState().contexts.blue.customToolId).toBeUndefined()
    expect(usePairColorStore.getState().contexts.blue.mcpServerId).toBeUndefined()
    expect(usePairColorStore.getState().contexts.blue.indicatorId).toBeUndefined()
    expect(usePairColorStore.getState().contexts.blue.pineIndicatorId).toBeUndefined()
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
})
