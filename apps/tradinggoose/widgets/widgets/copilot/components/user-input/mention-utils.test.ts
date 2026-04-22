import { describe, expect, it } from 'vitest'
import {
  buildAggregatedMentionItems,
  filterMentionOptions,
  filterWorkspaceEntitiesForOption,
  getMentionSubmenuTitle,
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
  logsList: [],
  workflowBlocks: [],
})

describe('mention-utils', () => {
  it('surfaces centralized workspace entity mention options in option filtering', () => {
    expect(filterMentionOptions('tool')).toContain('Custom Tools')
    expect(filterMentionOptions('mcp')).toContain('MCP Servers')
  })

  it('filters workspace entity submenu items by option', () => {
    const sources = createMentionSources()

    expect(filterWorkspaceEntitiesForOption('Skills', sources, 'risk')).toEqual([
      sources.workspaceEntities.skill[0],
    ])

    expect(filterWorkspaceEntitiesForOption('MCP Servers', sources, 'http')).toEqual([
      sources.workspaceEntities.mcp_server[0],
    ])
  })

  it('includes workspace entity matches in aggregated search results', () => {
    const sources = createMentionSources()

    expect(buildAggregatedMentionItems('alpha', sources)).toEqual([
      {
        type: 'Workflows',
        id: 'workflow-1',
        value: sources.workspaceEntities.workflow[0],
      },
    ])

    expect(buildAggregatedMentionItems('slack', sources)).toEqual([
      {
        type: 'Custom Tools',
        id: 'tool-1',
        value: sources.workspaceEntities.custom_tool[0],
      },
    ])
  })

  it('uses centralized submenu titles for workspace entity mention groups', () => {
    expect(getMentionSubmenuTitle('Workflows')).toBe('All workflows')
    expect(getMentionSubmenuTitle('Indicators')).toBe('Indicators')
  })
})
