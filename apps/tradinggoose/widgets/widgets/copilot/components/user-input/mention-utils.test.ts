import { describe, expect, it } from 'vitest'
import {
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
} from '@/i18n/workflow-inspector-core'
import enMessages from '../../../../../i18n/messages/en.json'
import esMessages from '../../../../../i18n/messages/es.json'
import zhMessages from '../../../../../i18n/messages/zh.json'
import {
  getCopilotMentionCopyFromMessages,
  getMentionOptionLabel,
  getMentionSubmenuTitle,
} from './mention-copy'
import {
  buildAggregatedMentionItems,
  filterBlocks,
  filterLogs,
  filterMentionOptions,
  filterWorkspaceEntitiesForOption,
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
        functionName: 'sendSlackAlert',
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
  const enMentionCopy = getCopilotMentionCopyFromMessages(enMessages as any)
  const esMentionCopy = getCopilotMentionCopyFromMessages(esMessages as any)
  const zhMentionCopy = getCopilotMentionCopyFromMessages(zhMessages as any)
  const enMonitorCopy = (enMessages as any).workspace.monitor
  const esMonitorCopy = (esMessages as any).workspace.monitor
  const zhMonitorCopy = (zhMessages as any).workspace.monitor

  it('surfaces centralized workspace entity mention options in option filtering', () => {
    expect(filterMentionOptions('tool', enMentionCopy)).toContain('custom_tool')
    expect(filterMentionOptions('工具', zhMentionCopy)).toContain('custom_tool')
  })

  it('filters workspace entity submenu items by option', () => {
    const sources = createMentionSources()

    expect(filterWorkspaceEntitiesForOption('skill', sources, 'risk', enMentionCopy)).toEqual([
      sources.workspaceEntities.skill[0],
    ])

    expect(filterWorkspaceEntitiesForOption('mcp_server', sources, 'http', enMentionCopy)).toEqual([
      sources.workspaceEntities.mcp_server[0],
    ])
  })

  it('includes workspace entity matches in aggregated search results', () => {
    const sources = createMentionSources()

    expect(buildAggregatedMentionItems('alpha', sources, enMentionCopy, enMonitorCopy)).toEqual([
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

    expect(buildAggregatedMentionItems('slack', sources, enMentionCopy, enMonitorCopy)).toEqual([
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
    expect(buildAggregatedMentionItems('计划', sources, zhMentionCopy, zhMonitorCopy)).toEqual([
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
      buildAggregatedMentionItems('condicion 2', sources, esMentionCopy, esMonitorCopy)
    ).toEqual([
      {
        type: 'workflow_blocks',
        id: 'workflow-block-1',
        value: sources.workflowBlocks[0],
      },
    ])
  })

  it('uses centralized submenu titles for workspace entity mention groups', () => {
    expect(getMentionOptionLabel(enMentionCopy, 'workflow')).toBe('Workflows')
    expect(getMentionSubmenuTitle(enMentionCopy, 'workflow')).toBe('All workflows')
    expect(getMentionSubmenuTitle(zhMentionCopy, 'indicator')).toBe('指标')
    expect(getMentionSubmenuTitle(esMentionCopy, 'knowledge')).toBe('Bases de conocimiento')
  })
})
