import { describe, expect, it } from 'vitest'
import {
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
} from '@/i18n/workflow-inspector-core'
import enMessages from '../../../../../i18n/messages/en.json'
import esMessages from '../../../../../i18n/messages/es.json'
import zhMessages from '../../../../../i18n/messages/zh.json'
import {
  getCopilotMentionCopy,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
} from './mention-copy'
import {
  buildAggregatedMentionItems,
  buildMentionRanges,
  filterBlocks,
  filterLogs,
  filterMentionOptions,
} from './mention-utils'
import type { MentionSources } from './types'

const createMentionSources = (): MentionSources => ({
  pastChats: [],
  workspaceEntities: {
    workflow: [
      {
        entityKind: 'workflow',
        id: 'workflow-1',
        name: 'Alpha Workflow',
        color: '#3972F6',
      },
    ],
    skill: [
      {
        entityKind: 'skill',
        id: 'skill-1',
        name: 'Risk Filter',
        description: 'Filters noisy setups',
      },
    ],
    indicator: [
      {
        entityKind: 'indicator',
        id: 'indicator-1',
        name: 'Momentum RSI',
        color: '#22c55e',
      },
    ],
    custom_tool: [
      {
        entityKind: 'custom_tool',
        id: 'tool-1',
        name: 'Slack Alerts',
      },
    ],
    mcp_server: [
      {
        entityKind: 'mcp_server',
        id: 'mcp-1',
        name: 'Broker MCP',
        transport: 'http',
      },
    ],
  },
  knowledgeBases: [],
  blocksList: [],
  logsList: [
    {
      id: 'log-1',
      level: 'info',
      trigger: 'schedule',
      startedAt: '2026-04-17T00:00:00.000Z',
      entityName: 'Alpha Workflow',
    },
  ],
  workflowBlocks: [],
})

describe('mention-utils', () => {
  const enMentionCopy = getCopilotMentionCopy({
    dashboard: (enMessages as any).workspace.dashboard,
    nav: (enMessages as any).nav,
    widgets: (enMessages as any).workspace.widgets,
  })
  const zhMentionCopy = getCopilotMentionCopy({
    dashboard: (zhMessages as any).workspace.dashboard,
    nav: (zhMessages as any).nav,
    widgets: (zhMessages as any).workspace.widgets,
  })
  const esMentionCopy = getCopilotMentionCopy({
    dashboard: (esMessages as any).workspace.dashboard,
    nav: (esMessages as any).nav,
    widgets: (esMessages as any).workspace.widgets,
  })
  const enMonitorCopy = (enMessages as any).workspace.monitor
  const esMonitorCopy = (esMessages as any).workspace.monitor
  const zhMonitorCopy = (zhMessages as any).workspace.monitor

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
      {
        type: 'logs',
        id: 'log-1',
        value: sources.logsList[0],
      },
    ])

    expect(buildAggregatedMentionItems('slack', sources, enMonitorCopy, enMentionCopy)).toEqual([
      {
        type: 'custom_tool',
        id: 'tool-1',
        value: sources.workspaceEntities.custom_tool[0],
      },
    ])
  })

  it('matches logs by localized trigger labels', () => {
    const sources = createMentionSources()

    expect(filterLogs(sources.logsList, 'programación', esMonitorCopy)).toEqual([
      sources.logsList[0],
    ])
    expect(filterLogs(sources.logsList, '计划', zhMonitorCopy)).toEqual([sources.logsList[0]])
    expect(buildAggregatedMentionItems('计划', sources, zhMonitorCopy, zhMentionCopy)).toEqual([
      {
        type: 'logs',
        id: 'log-1',
        value: sources.logsList[0],
      },
    ])
  })

  it('matches blocks by localized block names', () => {
    const localizedBlockName = getLocalizedBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition'
    )
    const blockItem = {
      id: 'condition',
      name: localizedBlockName,
    }

    expect(filterBlocks([blockItem], 'condicion')).toEqual([blockItem])
  })

  it('includes localized workflow block matches in aggregated search results', () => {
    const sources = createMentionSources()
    const localizedWorkflowBlockName = getLocalizedDefaultBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition',
      'Condition 2'
    )
    sources.workflowBlocks = [
      {
        id: 'workflow-block-1',
        type: 'condition',
        name: localizedWorkflowBlockName,
      },
    ]

    expect(
      buildAggregatedMentionItems('condicion 2', sources, esMonitorCopy, esMentionCopy)
    ).toEqual([
      {
        type: 'workflow_blocks',
        id: 'workflow-block-1',
        value: sources.workflowBlocks[0],
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
    expect(buildAggregatedMentionItems(toolLabel, sources, esMonitorCopy, esMentionCopy)).toEqual([
      { type: 'custom_tool', id: 'tool-empty', value: sources.workspaceEntities.custom_tool[0] },
    ])
    expect(buildAggregatedMentionItems(chatLabel, sources, esMonitorCopy, esMentionCopy)).toEqual([
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
})
