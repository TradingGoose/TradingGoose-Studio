import { describe, expect, it } from 'vitest'
import { stripCopilotWorkspaceEntityMentions } from '@/lib/copilot/chat-contexts'
import enMessages from '../../../../../i18n/messages/en.json'
import esMessages from '../../../../../i18n/messages/es.json'
import zhMessages from '../../../../../i18n/messages/zh.json'
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
  upsertMentionContextByTextOrder,
} from './mention-utils'
import type { MentionSources } from './types'

const createMentionSources = (): MentionSources => ({
  pastChats: [],
  workspaceEntities: {
    workflow: [{ entityKind: 'workflow', id: 'workflow-1', name: 'Alpha Workflow' }],
    skill: [],
    indicator: [],
    custom_tool: [{ entityKind: 'custom_tool', id: 'tool-1', name: 'Slack Alerts' }],
    mcp_server: [],
    watchlist: [{ entityKind: 'watchlist', id: 'watchlist-1', name: 'Growth' }],
    dashboard_layout: [{ entityKind: 'dashboard_layout', id: 'layout-1', name: 'Trading Desk' }],
  },
  knowledgeBases: [],
  blocksList: [],
  logsList: [],
  workflowBlocks: [],
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
    sources.pastChats = [{ reviewSessionId: 'chat-1', title: null, workflowId: null }]
    sources.workspaceEntities.custom_tool = [
      { entityKind: 'custom_tool', id: 'tool-empty', name: '', description: '' },
    ]
    const chatLabel = (esMessages as any).workspace.widgets.copilot.history.newChat
    const toolLabel = (esMessages as any).workspace.widgets.customToolDropdown.untitledCustomTool

    expect(getPastChatMentionLabel(esMentionCopy, sources.pastChats[0])).toBe(chatLabel)
    expect(
      getWorkspaceEntityMentionLabel(esMentionCopy, sources.workspaceEntities.custom_tool[0])
    ).toBe(toolLabel)
    expect(buildAggregatedMentionItems(toolLabel, sources, enMonitorCopy, esMentionCopy)).toEqual([
      { type: 'custom_tool', id: 'tool-empty', value: sources.workspaceEntities.custom_tool[0] },
    ])
    expect(buildAggregatedMentionItems(chatLabel, sources, enMonitorCopy, esMentionCopy)).toEqual([
      { type: 'chats', id: 'chat-1', value: sources.pastChats[0] },
    ])

    sources.workspaceEntities.custom_tool[0].name = 'untitled'
    expect(
      getWorkspaceEntityMentionLabel(esMentionCopy, sources.workspaceEntities.custom_tool[0])
    ).toBe('untitled')

    sources.pastChats[0].title = 'untitled'
    expect(getPastChatMentionLabel(esMentionCopy, sources.pastChats[0])).toBe('untitled')
  })

  it('tracks duplicate mention labels by context identity', () => {
    const ranges = buildMentionRanges('@Untitled @Untitled', [
      { kind: 'custom_tool', customToolId: 'tool-1', label: 'Untitled' },
      { kind: 'custom_tool', customToolId: 'tool-2', label: 'Untitled' },
    ])

    expect(ranges.map((range) => range.contextKey)).toEqual([
      'custom_tool:tool-1',
      'custom_tool:tool-2',
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

  it('tracks repeated text for the same mention context', () => {
    const ranges = buildMentionRanges('@Docs @Docs', [{ kind: 'docs', label: 'Docs' }])

    expect(ranges.map((range) => range.contextKey)).toEqual(['docs', 'docs'])
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

  it('strips only workspace-entity ranges from model-bound text', () => {
    const contexts = [
      { kind: 'docs' as const, label: 'Shared' },
      { kind: 'workflow' as const, workflowId: 'workflow-1', label: 'Shared' },
    ]

    expect(stripCopilotWorkspaceEntityMentions('@Shared @Shared', contexts)).toBe('@Shared ')
  })
})
