import { describe, expect, it } from 'vitest'
import { replaceCopilotWorkspaceEntityMentionsWithIds } from '@/lib/copilot/chat-contexts'
import enMessages from '@/i18n/messages/en.json'
import esMessages from '@/i18n/messages/es.json'
import zhMessages from '@/i18n/messages/zh.json'
import {
  getCopilotMentionCopy,
  getMentionOptionLabel,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
} from './mention-copy'
import {
  buildAggregatedMentionItems,
  buildMentionRanges,
  filterMentionOptions,
  retainMentionContextsInText,
  upsertMentionContextByTextOrder,
} from './mention-utils'
import type { MentionSources } from './types'

const createMentionSources = (): MentionSources => ({
  pastChats: [],
  workspaceEntities: {
    workflow: [{ entityKind: 'workflow', id: 'workflow-1', name: 'Alpha Workflow' }],
    skill: [],
    indicator: [],
    knowledge_base: [],
    custom_tool: [{ entityKind: 'custom_tool', id: 'tool-1', name: 'Slack Alerts' }],
    mcp_server: [],
    watchlist: [{ entityKind: 'watchlist', id: 'watchlist-1', name: 'Growth' }],
    dashboard_layout: [{ entityKind: 'dashboard_layout', id: 'layout-1', name: 'Trading Desk' }],
  },
  blocksList: [],
  logsList: [],
})

const getMentionCopy = (messages: any) =>
  getCopilotMentionCopy({
    dashboard: messages.workspace.dashboard,
    knowledge: messages.workspace.knowledge,
    nav: messages.nav,
    widgets: messages.workspace.widgets,
  })

describe('mention-utils', () => {
  const enMentionCopy = getMentionCopy(enMessages)
  const zhMentionCopy = getMentionCopy(zhMessages)
  const esMentionCopy = getMentionCopy(esMessages)
  const enMonitorCopy = (enMessages as any).workspace.monitor

  it('surfaces centralized workspace entity mention options in option filtering', () => {
    expect(filterMentionOptions('tool', enMentionCopy)).toContain('custom_tool')
    expect(filterMentionOptions('工具', zhMentionCopy)).toContain('custom_tool')
  })

  it('includes workspace entity matches in aggregated search results', () => {
    const sources = createMentionSources()

    expect(buildAggregatedMentionItems('alpha', sources, enMonitorCopy, enMentionCopy)).toEqual([
      {
        type: 'workflow',
        id: 'workflow-1',
        value: sources.workspaceEntities.workflow[0],
      },
    ])

    expect(buildAggregatedMentionItems('slack', sources, enMonitorCopy, enMentionCopy)).toEqual([
      {
        type: 'custom_tool',
        id: 'tool-1',
        value: sources.workspaceEntities.custom_tool[0],
      },
    ])

    expect(buildAggregatedMentionItems('growth', sources, enMonitorCopy, enMentionCopy)).toEqual([
      {
        type: 'watchlist',
        id: 'watchlist-1',
        value: sources.workspaceEntities.watchlist[0],
      },
    ])
  })

  it('uses localized untitled labels for empty chat and workspace entity names', () => {
    const sources = createMentionSources()
    sources.pastChats = [{ reviewSessionId: 'chat-1', title: null }]
    sources.workspaceEntities.custom_tool = [
      { entityKind: 'custom_tool', id: 'tool-empty', name: '', description: '' },
    ]
    sources.workspaceEntities.knowledge_base = [
      { entityKind: 'knowledge_base', id: 'knowledge-empty', name: '', description: '' },
    ]
    const chatLabel = (esMessages as any).workspace.widgets.copilot.history.newChat
    const toolLabel = (esMessages as any).workspace.widgets.customToolDropdown.untitledCustomTool
    const knowledgeLabel = esMessages.workspace.knowledge.defaults.untitledKnowledgeBase

    expect(getPastChatMentionLabel(esMentionCopy, sources.pastChats[0])).toBe(chatLabel)
    expect(
      getWorkspaceEntityMentionLabel(esMentionCopy, sources.workspaceEntities.custom_tool[0])
    ).toBe(toolLabel)
    expect(
      getWorkspaceEntityMentionLabel(esMentionCopy, sources.workspaceEntities.knowledge_base[0])
    ).toBe(knowledgeLabel)
    expect(
      getWorkspaceEntityMentionLabel(zhMentionCopy, sources.workspaceEntities.knowledge_base[0])
    ).toBe(zhMessages.workspace.knowledge.defaults.untitledKnowledgeBase)
    expect(buildAggregatedMentionItems(toolLabel, sources, enMonitorCopy, esMentionCopy)).toEqual([
      { type: 'custom_tool', id: 'tool-empty', value: sources.workspaceEntities.custom_tool[0] },
    ])
    expect(buildAggregatedMentionItems(chatLabel, sources, enMonitorCopy, esMentionCopy)).toEqual([
      { type: 'chats', id: 'chat-1', value: sources.pastChats[0] },
    ])
    expect(
      buildAggregatedMentionItems(knowledgeLabel, sources, enMonitorCopy, esMentionCopy)
    ).toEqual([
      {
        type: 'knowledge_base',
        id: 'knowledge-empty',
        value: sources.workspaceEntities.knowledge_base[0],
      },
    ])

    sources.workspaceEntities.custom_tool[0].name = 'untitled'
    expect(
      getWorkspaceEntityMentionLabel(esMentionCopy, sources.workspaceEntities.custom_tool[0])
    ).toBe('untitled')

    sources.pastChats[0].title = 'untitled'
    expect(getPastChatMentionLabel(esMentionCopy, sources.pastChats[0])).toBe('untitled')
  })

  it('deletes duplicate mention labels by context identity', () => {
    const contexts = [
      { kind: 'custom_tool', customToolId: 'tool-1', label: 'Untitled' },
      { kind: 'custom_tool', customToolId: 'tool-2', label: 'Untitled' },
    ] as const
    const ranges = buildMentionRanges('@Untitled @Untitled', [...contexts])

    expect(ranges.map((range) => range.contextKey)).toEqual([
      'custom_tool:tool-1',
      'custom_tool:tool-2',
    ])
    expect(retainMentionContextsInText('@Untitled @Untitled', [...contexts], ranges[0])).toEqual([
      contexts[1],
    ])
    expect(retainMentionContextsInText('@Untitled @Untitled', [...contexts], ranges[1])).toEqual([
      contexts[0],
    ])
  })

  it('orders duplicate mention labels by insertion position', () => {
    const contexts = upsertMentionContextByTextOrder(
      [{ kind: 'custom_tool', customToolId: 'tool-1', label: 'Untitled' }],
      { kind: 'custom_tool', customToolId: 'tool-2', label: 'Untitled' },
      '@Untitled',
      0
    )
    const ranges = buildMentionRanges('@Untitled @Untitled', contexts)

    expect(ranges.map((range) => range.contextKey)).toEqual([
      'custom_tool:tool-2',
      'custom_tool:tool-1',
    ])
  })

  it('retains a repeated mention identity when one occurrence is deleted', () => {
    const context = { kind: 'docs' as const, label: 'Docs' }
    const ranges = buildMentionRanges('@Docs @Docs', [context])

    expect(ranges.map((range) => range.contextKey)).toEqual(['docs', 'docs'])
    expect(retainMentionContextsInText('@Docs @Docs', [context], ranges[0])).toEqual([context])
  })

  it('reconciles text and structured mention contexts in one draft value', () => {
    const contexts = [
      { kind: 'docs' as const, label: 'Docs' },
      { kind: 'workflow' as const, workflowId: 'workflow-1', label: 'Workflow' },
    ]

    expect(retainMentionContextsInText('Keep @Workflow only', contexts)).toEqual([contexts[1]])
    expect(retainMentionContextsInText('', contexts)).toEqual([])
  })

  it('skips malformed contexts while building and retaining mention ranges', () => {
    const docsContext = { kind: 'docs' as const, label: 'Docs' }
    const contexts = [
      {
        kind: 'dashboard_layout' as const,
        dashboardLayoutId: 'layout-1',
        label: 'Layout',
      },
      docsContext,
    ]

    expect(buildMentionRanges('@Layout @Docs', contexts)).toEqual([
      { start: 8, end: 13, label: 'Docs', contextKey: 'docs' },
    ])
    expect(retainMentionContextsInText('@Layout @Docs', contexts)).toEqual([docsContext])
  })

  it('tracks the refreshed localized label for the same canonical context', () => {
    const docsLabel = getMentionOptionLabel(esMentionCopy, 'docs')
    const ranges = buildMentionRanges(`@Docs @${docsLabel}`, [{ kind: 'docs', label: docsLabel }])

    expect(ranges.map((range) => range.contextKey)).toEqual(['docs'])
  })

  it('keeps mention ranges when punctuation touches the token', () => {
    const ranges = buildMentionRanges('(@Docs), @Untitled.', [
      { kind: 'docs', label: 'Docs' },
      { kind: 'custom_tool', customToolId: 'tool-1', label: 'Untitled' },
    ])

    expect(ranges.map((range) => range.contextKey)).toEqual(['docs', 'custom_tool:tool-1'])
  })

  it('prefers the longest exact mention label when labels share a prefix', () => {
    const ranges = buildMentionRanges('@Alpha Workflow, then @Alpha.', [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Alpha' },
      { kind: 'skill', skillId: 'skill-1', label: 'Alpha Workflow' },
    ])

    expect(ranges.map((range) => range.contextKey)).toEqual([
      'skill:skill-1',
      'workflow:workflow-1',
    ])
  })

  it('replaces ordered workspace-entity ranges with ids in model-bound text', () => {
    const contexts = [
      { kind: 'workflow' as const, workflowId: 'workflow-source', label: 'Shared' },
      { kind: 'workflow' as const, workflowId: 'workflow-target', label: 'Shared' },
    ]

    expect(
      replaceCopilotWorkspaceEntityMentionsWithIds('Copy (@Shared) into @Shared.', contexts)
    ).toBe('Copy (@workflow-source) into @workflow-target.')
  })
})
