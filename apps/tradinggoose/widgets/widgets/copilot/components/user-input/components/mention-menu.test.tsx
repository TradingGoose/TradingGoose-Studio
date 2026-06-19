/**
 * @vitest-environment jsdom
 */

import { act, createRef } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
} from '@/i18n/workflow-inspector-core'
import esMessages from '../../../../../../i18n/messages/es.json'
import zhMessages from '../../../../../../i18n/messages/zh.json'
import type { MentionSources, MentionSubmenu } from '../types'
import { MentionMenu } from './mention-menu'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const stripAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const createMentionSources = (): MentionSources => ({
  pastChats: [],
  workspaceEntities: {
    workflow: [],
    skill: [],
    indicator: [],
    custom_tool: [],
    mcp_server: [],
  },
  knowledgeBases: [],
  blocksList: [],
  logsList: [],
  workflowBlocks: [],
})

const loadingState: Record<MentionSubmenu, boolean> = {
  chats: false,
  workflow: false,
  skill: false,
  indicator: false,
  custom_tool: false,
  mcp_server: false,
  workflow_blocks: false,
  blocks: false,
  knowledge: false,
  logs: false,
}

describe('MentionMenu i18n', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderMenu = async ({
    locale,
    messages,
    openSubmenuFor = null,
    sources = createMentionSources(),
    mentionQuery = '',
    submenuQuery = '',
  }: {
    locale: 'es' | 'zh'
    messages: unknown
    openSubmenuFor?: MentionSubmenu | null
    sources?: MentionSources
    mentionQuery?: string
    submenuQuery?: string
  }) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={messages as any}>
          <MentionMenu
            inAggregated={false}
            loading={loadingState}
            mentionActiveIndex={0}
            mentionMenuRef={createRef<HTMLDivElement>()}
            mentionPortalRef={createRef<HTMLDivElement>()}
            mentionPortalStyle={{
              top: 48,
              left: 24,
              width: 320,
              maxHeight: 240,
              showBelow: true,
            }}
            mentionQuery={mentionQuery}
            menuListRef={createRef<HTMLDivElement>()}
            onAggregatedItemHover={() => {}}
            onMainOptionHover={() => {}}
            onSelectAggregatedItem={() => {}}
            onSelectMainOption={() => {}}
            onSelectSubmenuItem={() => {}}
            onSubmenuItemHover={() => {}}
            openSubmenuFor={openSubmenuFor}
            showMentionMenu
            sources={sources}
            submenuActiveIndex={0}
            submenuQuery={submenuQuery}
          />
        </NextIntlClientProvider>
      )
    })
  }

  it('renders localized main menu labels in spanish', async () => {
    await renderMenu({
      locale: 'es',
      messages: esMessages,
    })

    expect(document.body.textContent).toContain(
      (esMessages as any).workspace.widgets.workflowLabels.workflows
    )
    expect(document.body.textContent).not.toContain(
      (esMessages as any).workspace.widgets.workflowLabels.allWorkflows
    )
    expect(document.body.textContent).toContain('Bloques del flujo de trabajo')
    expect(document.body.textContent).toContain('Documentación')
  })

  it('renders localized empty workflow state in spanish', async () => {
    await renderMenu({
      locale: 'es',
      messages: esMessages,
      openSubmenuFor: 'workflow',
    })

    expect(document.body.textContent).toContain(
      (esMessages as any).workspace.widgets.workflowLabels.allWorkflows
    )
    expect(document.body.textContent).toContain('No se encontraron flujos de trabajo')
  })

  it('filters unnamed workflows using the localized spanish fallback label', async () => {
    const untitledWorkflowLabel = (esMessages as any).workspace.widgets.workflowDropdown
      .untitledWorkflow
    const sources = createMentionSources()
    sources.workspaceEntities.workflow = [
      {
        entityKind: 'workflow',
        id: 'workflow-1',
        name: '',
        color: '#3972F6',
      },
    ]

    await renderMenu({
      locale: 'es',
      messages: esMessages,
      openSubmenuFor: 'workflow',
      sources,
      submenuQuery: stripAccents(untitledWorkflowLabel.toLowerCase()),
    })

    expect(document.body.textContent).toContain(untitledWorkflowLabel)
    expect(document.body.textContent).not.toContain('No se encontraron flujos de trabajo')
  })

  it('renders localized block labels in the spanish blocks submenu', async () => {
    const localizedBlockName = getLocalizedBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition'
    )
    const sources = createMentionSources()
    sources.blocksList = [
      {
        id: 'condition',
        name: localizedBlockName,
      },
    ]

    await renderMenu({
      locale: 'es',
      messages: esMessages,
      openSubmenuFor: 'blocks',
      sources,
    })

    expect(document.body.textContent).toContain(localizedBlockName)
  })

  it('filters and renders logs using localized chinese trigger labels', async () => {
    const sources = createMentionSources()
    sources.logsList = [
      {
        id: 'log-1',
        level: 'info',
        trigger: 'schedule',
        startedAt: '2026-04-17T00:00:00.000Z',
        entityName: 'Alpha Workflow',
      },
    ]

    await renderMenu({
      locale: 'zh',
      messages: zhMessages,
      openSubmenuFor: 'logs',
      sources,
      submenuQuery: '计划',
    })

    expect(document.body.textContent).toContain('Alpha Workflow')
    expect(document.body.textContent).toContain('计划')
    expect(document.body.textContent).not.toContain('未找到执行记录')
  })

  it('renders localized workflow block labels in the spanish workflow blocks submenu', async () => {
    const localizedWorkflowBlockName = getLocalizedDefaultBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition',
      'Condition 2'
    )
    const sources = createMentionSources()
    sources.workflowBlocks = [
      {
        id: 'workflow-block-1',
        type: 'condition',
        name: localizedWorkflowBlockName,
      },
    ]

    await renderMenu({
      locale: 'es',
      messages: esMessages,
      openSubmenuFor: 'workflow_blocks',
      sources,
      submenuQuery: 'condicion 2',
    })

    expect(document.body.textContent).toContain(localizedWorkflowBlockName)
  })

  it('filters blocks using localized chinese block names', async () => {
    const localizedBlockName = getLocalizedBlockNameWithCopy(
      (zhMessages as any).workspace.widgets,
      'condition'
    )
    const sources = createMentionSources()
    sources.blocksList = [
      {
        id: 'condition',
        name: localizedBlockName,
      },
    ]

    await renderMenu({
      locale: 'zh',
      messages: zhMessages,
      openSubmenuFor: 'blocks',
      sources,
      submenuQuery: localizedBlockName,
    })

    expect(document.body.textContent).toContain(localizedBlockName)
  })

  it('filters blocks using accentless spanish queries', async () => {
    const localizedBlockName = getLocalizedBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition'
    )
    const sources = createMentionSources()
    sources.blocksList = [
      {
        id: 'condition',
        name: localizedBlockName,
      },
    ]

    await renderMenu({
      locale: 'es',
      messages: esMessages,
      openSubmenuFor: 'blocks',
      sources,
      submenuQuery: 'condicion',
    })

    expect(document.body.textContent).toContain(localizedBlockName)
  })
})
