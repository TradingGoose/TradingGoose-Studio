/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  INDICATOR_MONITOR_PROVIDER,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import type { MonitorDraft } from '../shared/types'

const {
  tradingProviderSelectorMock,
  tradingAccountSelectorMock,
  portfolioConditionBuilderMock,
} = vi.hoisted(() => ({
  tradingProviderSelectorMock: vi.fn(),
  tradingAccountSelectorMock: vi.fn(),
  portfolioConditionBuilderMock: vi.fn(),
}))

vi.mock('@/components/trading-selector/provider-selector', () => ({
  TradingProviderSelector: (props: Record<string, unknown>) => {
    tradingProviderSelectorMock(props)
    return <div data-testid='trading-provider-selector' />
  },
}))

vi.mock('@/components/trading-selector/account-selector', () => ({
  TradingAccountSelector: (props: Record<string, unknown>) => {
    tradingAccountSelectorMock(props)
    return <div data-testid='trading-account-selector' />
  },
}))

vi.mock('./portfolio-condition-builder', () => ({
  PortfolioConditionBuilder: (props: Record<string, unknown>) => {
    portfolioConditionBuilderMock(props)
    return <div data-testid='portfolio-condition-builder' />
  },
}))

import { MonitorEditorForm } from './monitor-editor-form'

const createDraft = (): MonitorDraft => ({
  source: PORTFOLIO_MONITOR_PROVIDER,
  workflowId: '',
  blockId: '',
  providerId: '',
  interval: '',
  indicatorId: '',
  listing: null,
  serviceId: '',
  credentialId: '',
  accountId: '',
  condition: {
    root: {
      combinator: 'and',
      rules: [],
    },
  },
  fireMode: 'edge',
  cooldownSeconds: 60,
  pollIntervalSeconds: 30,
  secretValues: {},
  providerParamValues: {},
  indicatorInputs: {},
  existingEncryptedSecretFieldIds: [],
  isActive: true,
})

describe('MonitorEditorForm localized portfolio path', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
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

  it.each(['es', 'zh'] as const)(
    'renders localized portfolio source and form labels for %s',
    async (locale) => {
      const copy = getPublicCopy(locale).workspace.monitor
      const blockEditorCopy = getPublicCopy(locale).workspace.widgets.blockEditor

      await act(async () => {
        root.render(
          <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
            <MonitorEditorForm
              workspaceId='workspace-1'
              editingKey={null}
              draft={createDraft()}
              errors={{}}
              saving={false}
              marketProviders={[]}
              tradingProviders={[{ id: 'alpaca', name: 'Alpaca' }]}
              providerIntervals={[]}
              providerIntervalsByProviderId={{}}
              defaultDraftInterval='1m'
              workflowTargets={[]}
              indicatorPickerOptions={[]}
              indicatorInputMeta={undefined}
              nonSecretDefinitions={[]}
              secretDefinitions={[]}
              listingInstanceId={null}
              onCancel={vi.fn()}
              onSave={vi.fn()}
              onUpdateDraft={vi.fn()}
              onUpdateSecretValue={vi.fn()}
              onUpdateProviderParamValue={vi.fn()}
              onUpdateIndicatorInputs={vi.fn()}
            />
          </NextIntlClientProvider>
        )
      })

      expect(container.textContent).toContain(copy.editor.form.sourceLabel)
      expect(container.textContent).toContain(copy.editor.form.sourcePortfolio)
      expect(container.textContent).toContain(copy.editor.form.tradingProvider)
      expect(container.textContent).toContain(copy.editor.form.tradingAccount)
      expect(container.textContent).toContain(copy.fields.workflowTarget)
      expect(container.textContent).toContain(copy.editor.form.workflowTargetPlaceholder)
      expect(container.textContent).toContain(copy.editor.form.fireMode)
      expect(container.textContent).toContain(copy.editor.form.fireModeEdge)
      expect(container.textContent).toContain(copy.editor.form.cooldownSeconds)
      expect(container.textContent).toContain(copy.editor.form.pollSeconds)
      expect(container.textContent).not.toContain('Trading provider')
      expect(container.textContent).not.toContain('Workflow Target')

      const tradingProviderSelectorProps = tradingProviderSelectorMock.mock.calls.at(-1)?.[0]
      const tradingAccountSelectorProps = tradingAccountSelectorMock.mock.calls.at(-1)?.[0]

      expect(tradingProviderSelectorProps).toMatchObject({ variant: 'form' })
      expect(tradingProviderSelectorProps).not.toHaveProperty('placeholder')
      expect(tradingAccountSelectorProps).toMatchObject({
        toolName: blockEditorCopy.blockNames.portfolio_state_trigger,
        variant: 'form',
      })
      expect(tradingAccountSelectorProps).not.toHaveProperty('placeholder')
      expect(tradingAccountSelectorProps).not.toHaveProperty('tooltipText')

      await act(async () => {
        root.render(
          <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
            <MonitorEditorForm
              workspaceId='workspace-1'
              editingKey={null}
              draft={{ ...createDraft(), source: INDICATOR_MONITOR_PROVIDER }}
              errors={{}}
              saving={false}
              marketProviders={[]}
              tradingProviders={[{ id: 'alpaca', name: 'Alpaca' }]}
              providerIntervals={[]}
              providerIntervalsByProviderId={{}}
              defaultDraftInterval='1m'
              workflowTargets={[]}
              indicatorPickerOptions={[]}
              indicatorInputMeta={undefined}
              nonSecretDefinitions={[]}
              secretDefinitions={[]}
              listingInstanceId={null}
              onCancel={vi.fn()}
              onSave={vi.fn()}
              onUpdateDraft={vi.fn()}
              onUpdateSecretValue={vi.fn()}
              onUpdateProviderParamValue={vi.fn()}
              onUpdateIndicatorInputs={vi.fn()}
            />
          </NextIntlClientProvider>
        )
      })

      expect(container.textContent).toContain(copy.editor.form.sourceIndicator)
    }
  )
})
