import { afterEach, describe, expect, it } from 'vitest'
import { defaultLocale, locales } from '../../i18n/routing'
import { parseCliFlags, runCatalogCli } from './index'
import { deriveRouteNamespace, getRouteOwnedNamespaces } from './ownership'
import {
  buildAllReport,
  buildRouteReport,
  cleanupTempProjects,
  createAllModeEmailProject,
  createArrayBuiltinProject,
  createBaseProject,
  createChangelogProject,
  createCopyPassThroughMonitorProject,
  createDynamicLocaleGapProject,
  createImportedRenderPropMonitorProject,
  createInlineFormatterProject,
  createLandingArrayProject,
  createLoadingAllModeProject,
  createLocaleMessages,
  createNotFoundAllModeProject,
  createOptionalChainMonitorProject,
  createRenderPropMonitorProject,
  createReturnTypeMonitorProject,
  createRouteBoundaryProject,
  createStartTransitionMonitorProject,
  createStringMethodMonitorProject,
  createTempProject,
  createTimerCallbackMonitorProject,
  createUnusedExportedHelperMonitorProject,
  createUnusedHelperMonitorProject,
  createUnusedImportedRenderPropMonitorProject,
  createUnusedRenderPropMonitorProject,
  createUnusedUseCallbackMonitorProject,
  createUseCallbackMonitorProject,
  createVerifyPromiseProject,
  createWrappedExportMonitorProject,
  getCoveragePathKeys,
  parseLocaleMessages,
  snapshotFiles,
  toJson,
} from './test-utils'

afterEach(cleanupTempProjects)

describe('i18n catalog report derivation', () => {
  it('parses `--show-used-keys` only when explicitly requested', () => {
    expect(parseCliFlags(['--route', '/x'])).toMatchObject({
      route: '/x',
      showUsedKeys: false,
    })
    expect(parseCliFlags(['--route', '/x', '--show-used-keys'])).toMatchObject({
      route: '/x',
      showUsedKeys: true,
    })
  })

  it('canonicalizes concrete CLI route inputs in scan and report output', () => {
    const projectRoot = createBaseProject()

    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/ws-1/monitor',
    })

    expect(cliResult.scan.routePath).toBe('/workspace/[workspaceId]/monitor')
    expect(cliResult.report.routePath).toBe('/workspace/[workspaceId]/monitor')
  })

  it('summarizes used keys in text output by default without changing report data', () => {
    const projectRoot = createUseCallbackMonitorProject()
    const expectedUsedKey = 'workspace.monitor.errors.loadViews'

    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/[workspaceId]/monitor',
    })
    const cliJson = JSON.parse(
      JSON.stringify({ scan: cliResult.scan, report: cliResult.report })
    ) as {
      report: {
        usedKeys: string[]
      }
    }

    expect(cliResult.report.usedKeys).toContain(expectedUsedKey)
    expect(cliResult.text).toContain(`Used keys: ${cliResult.report.usedKeys.length}`)
    expect(cliResult.text).not.toContain(expectedUsedKey)
    expect(cliJson.report.usedKeys).toContain(expectedUsedKey)
  })

  it('shows the complete used key list when route CLI opts in with `--show-used-keys`', () => {
    const projectRoot = createUseCallbackMonitorProject()
    const expectedUsedKey = 'workspace.monitor.errors.loadViews'

    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/[workspaceId]/monitor',
      showUsedKeys: true,
    })

    expect(cliResult.text).toContain(`Used keys: ${cliResult.report.usedKeys.length}`)
    expect(cliResult.text).toContain(expectedUsedKey)
  })

  it('omits orphan fields by default for route reports and CLI output', () => {
    const projectRoot = createCopyPassThroughMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor')
    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/[workspaceId]/monitor',
    })
    const cliJson = JSON.parse(
      JSON.stringify({ scan: cliResult.scan, report: cliResult.report })
    ) as {
      report: Record<string, unknown>
    }

    expect(report.orphanedKeys).toBeUndefined()
    expect(report.dynamicProtectedRoots).toBeUndefined()
    expect(cliResult.text).not.toContain('Orphaned keys:')
    expect(cliResult.text).not.toContain('Dynamic protected roots:')
    expect(cliJson.report).not.toHaveProperty('orphanedKeys')
    expect(cliJson.report).not.toHaveProperty('dynamicProtectedRoots')
  })

  it('includes orphan fields when route CLI opts in with `--with-orphans`', () => {
    const projectRoot = createCopyPassThroughMonitorProject()

    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/[workspaceId]/monitor',
      withOrphans: true,
    })

    expect(cliResult.report.orphanedKeys).toBeDefined()
    expect(cliResult.report.dynamicProtectedRoots).toBeDefined()
    expect(cliResult.text).toContain('Orphaned keys:')
    expect(cliResult.text).toContain('Dynamic protected roots:')
  })

  it('omits orphan fields by default for all reports and CLI output', () => {
    const projectRoot = createAllModeEmailProject()

    const { report } = buildAllReport(projectRoot)
    const cliResult = runCatalogCli(projectRoot, {
      all: true,
    })
    const cliJson = JSON.parse(
      JSON.stringify({ scan: cliResult.scan, report: cliResult.report })
    ) as {
      report: Record<string, unknown>
    }

    expect(report.orphanedKeys).toBeUndefined()
    expect(report.dynamicProtectedRoots).toBeUndefined()
    expect(cliResult.text).not.toContain('Orphaned keys:')
    expect(cliResult.text).not.toContain('Dynamic protected roots:')
    expect(cliJson.report).not.toHaveProperty('orphanedKeys')
    expect(cliJson.report).not.toHaveProperty('dynamicProtectedRoots')
  })

  it('includes orphan fields when all CLI opts in with `--with-orphans`', () => {
    const projectRoot = createAllModeEmailProject()

    const { report } = buildAllReport(projectRoot, { withOrphans: true })
    const cliResult = runCatalogCli(projectRoot, {
      all: true,
      withOrphans: true,
    })

    expect(report.orphanedKeys).toBeDefined()
    expect(report.dynamicProtectedRoots).toBeDefined()
    expect(cliResult.report.orphanedKeys).toBeDefined()
    expect(cliResult.report.dynamicProtectedRoots).toBeDefined()
    expect(cliResult.text).toContain('Orphaned keys:')
    expect(cliResult.text).toContain('Dynamic protected roots:')
  })

  it('tracks standalone all-mode email roots without widening helper-only email copy', () => {
    const projectRoot = createAllModeEmailProject()

    const { scanResult, report } = buildAllReport(projectRoot, { withOrphans: true })

    expect(scanResult.scannedFiles).toEqual(
      expect.arrayContaining(['components/emails/email-copy.ts', 'components/emails/render-email.ts'])
    )
    expect(report.usedKeys).toEqual(expect.arrayContaining(['emails.body', 'emails.subject']))
    expect(report.usedKeys).not.toContain('emails.orphan')
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'emails.orphan' })])
    )
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'emails.body' }),
        expect.objectContaining({ pathKey: 'emails.subject' }),
      ])
    )
  })

  it('does not report changelog structural and imported copy keys as orphaned', () => {
    const projectRoot = createChangelogProject()

    const changelogReport = buildRouteReport(projectRoot, '/changelog', {
      withOrphans: true,
    }).report

    expect(changelogReport.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'changelog.pageTitle' }),
        expect.objectContaining({ pathKey: 'changelog.viewOnGitHub' }),
        expect.objectContaining({ pathKey: 'changelog.documentation' }),
        expect.objectContaining({ pathKey: 'changelog.rssFeed' }),
        expect.objectContaining({ pathKey: 'changelog.viewContributorAriaLabel' }),
        expect.objectContaining({ pathKey: 'changelog.contributorAvatarAlt' }),
        expect.objectContaining({ pathKey: 'changelog.loadingMore' }),
        expect.objectContaining({ pathKey: 'changelog.showMore' }),
      ])
    )
  })

  it('keeps route dashboard coverage on selector and widget headers while all mode still covers bodies', () => {
    const messages = parseLocaleMessages()
    messages.workspace.widgets.inlineWidget = {
      body: {
        bodyOnly: 'Inline body only',
      },
      header: {
        action: 'Inline header action',
        title: 'Inline header title',
      },
    }
    const serializedMessages = JSON.stringify(messages, null, 2)
    const projectRoot = createTempProject({
      'i18n/messages/en.json': serializedMessages,
      'i18n/messages/es.json': serializedMessages,
      'i18n/messages/zh.json': serializedMessages,
      'app/[locale]/workspace/[workspaceId]/dashboard/page.tsx':
        "import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'\nexport default function Page(){ return <DashboardClient /> }\n",
      'app/workspace/[workspaceId]/dashboard/dashboard-client.tsx': `
'use client'

import { WidgetSurface } from '@/widgets/widget-surface'

export function DashboardClient() {
  return (
    <>
      <WidgetSurface widget={{ key: 'quick_order', params: null }} />
      <WidgetSurface widget={{ key: 'inline_widget', params: null }} />
    </>
  )
}
`,
      'widgets/widget-surface.tsx': `
'use client'

import { getWidgetDefinition } from '@/widgets/registry'
import { WidgetSelector } from '@/widgets/widgets/components/widget-selector'

export function WidgetSurface({ widget }: { widget: { key: string; params: null } }) {
  const definition = getWidgetDefinition(widget.key)
  const WidgetComponent = definition?.component
  const header = definition?.renderHeader?.({ widget } as any)

  return (
    <section>
      <WidgetSelector currentKey={widget.key} />
      <div>{header?.center}</div>
      <div>{WidgetComponent ? 'body-rooted-in-all-mode' : 'missing-body'}</div>
    </section>
  )
}
`,
      'widgets/widgets/components/widget-selector.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { getWidgetCategories } from '@/widgets/registry'

export function WidgetSelector({ currentKey }: { currentKey: string }) {
  const widgetsCopy = useMessages().workspace.widgets
  const categories = getWidgetCategories(widgetsCopy)

  return (
    <div title={widgetsCopy.selector.widgetSelectionUnavailable}>
      <span>{widgetsCopy.selector.selectWidget}</span>
      <span>{currentKey}</span>
      {categories.map((category) => (
        <span key={category.key}>{category.title}</span>
      ))}
    </div>
  )
}
`,
      'widgets/registry.tsx': `
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { inlineWidget } from '@/widgets/widgets/inline_widget'
import { quickOrderWidget } from '@/widgets/widgets/quick_order'

const widgetRegistry: Record<string, DashboardWidgetDefinition> = {
  inline_widget: inlineWidget,
  quick_order: quickOrderWidget,
}

export const getWidgetDefinition = (key: string): DashboardWidgetDefinition | undefined =>
  widgetRegistry[key]

export const getWidgetCategories = (widgetsCopy: {
  selector: {
    categories: Record<string, string>
  }
  titles: Record<string, string>
}) =>
  Object.values(widgetRegistry).map((widget) => ({
    ...widget,
    title: widgetsCopy.titles[widget.key] ?? widget.title,
    categoryTitle: widgetsCopy.selector.categories[widget.category],
  }))
`,
      'widgets/types.ts': `
import type { ReactNode } from 'react'

export type DashboardWidgetDefinition = {
  key: string
  title: string
  category: string
  component?: (props: any) => ReactNode
  renderHeader?: (props: any) => {
    center?: ReactNode
    left?: ReactNode
    right?: ReactNode
  }
}
`,
      'widgets/widgets/quick_order/index.tsx': `
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'

export const quickOrderWidget: DashboardWidgetDefinition = {
  key: 'quick_order',
  title: 'Quick Order',
  category: 'trading',
  component: QuickOrderWidgetBody,
  renderHeader: renderQuickOrderHeader,
}
`,
      'widgets/widgets/inline_widget/index.tsx': `
'use client'

import { useMessages } from 'next-intl'
import type { DashboardWidgetDefinition } from '@/widgets/types'

function InlineHeaderTitle() {
  const copy = useMessages().workspace.widgets.inlineWidget.header
  return <span>{copy.title}</span>
}

function InlineHeaderAction() {
  const copy = useMessages().workspace.widgets.inlineWidget.header
  return <button>{copy.action}</button>
}

function InlineBody() {
  const copy = useMessages().workspace.widgets.inlineWidget.body
  return <button>{copy.bodyOnly}</button>
}

export const inlineWidget: DashboardWidgetDefinition = {
  key: 'inline_widget',
  title: 'Inline Widget',
  category: 'utility',
  component: InlineBody,
  renderHeader: () => ({
    center: <InlineHeaderTitle />,
    right: <InlineHeaderAction />,
  }),
}
`,
      'widgets/widgets/quick_order/components/body.tsx': `
'use client'

import { useMessages } from 'next-intl'

export function QuickOrderWidgetBody() {
  const copy = useMessages().workspace.widgets.quickOrder.body
  return <button>{copy.submitOrder}</button>
}
`,
      'widgets/widgets/quick_order/components/header.tsx': `
'use client'

import { useMessages } from 'next-intl'

export function renderQuickOrderHeader() {
  const copy = useMessages().workspace.widgets.quickOrder.header
  return {
    center: <span>{copy.title}</span>,
    left: <span>{copy.buy}</span>,
  }
}
`,
    })

    const routeReport = buildRouteReport(projectRoot, '/workspace/[workspaceId]/dashboard', {
      withOrphans: true,
    }).report
    const allReport = buildAllReport(projectRoot, { withOrphans: true }).report

    expect(routeReport.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.widgets.inlineWidget.header.action',
        'workspace.widgets.inlineWidget.header.title',
        'workspace.widgets.selector.selectWidget',
        'workspace.widgets.selector.widgetSelectionUnavailable',
        'workspace.widgets.quickOrder.header.title',
      ])
    )
    expect(routeReport.usedKeys).not.toContain('workspace.widgets.quickOrder.body.submitOrder')
    expect(routeReport.usedKeys).not.toContain('workspace.widgets.inlineWidget.body.bodyOnly')
    expect(routeReport.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.widgets.inlineWidget.header.action' }),
        expect.objectContaining({ pathKey: 'workspace.widgets.inlineWidget.header.title' }),
        expect.objectContaining({ pathKey: 'workspace.widgets.selector.selectWidget' }),
        expect.objectContaining({
          pathKey: 'workspace.widgets.selector.widgetSelectionUnavailable',
        }),
        expect.objectContaining({ pathKey: 'workspace.widgets.quickOrder.header.title' }),
      ])
    )
    expect(allReport.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.widgets.inlineWidget.body.bodyOnly',
        'workspace.widgets.inlineWidget.header.title',
        'workspace.widgets.quickOrder.body.submitOrder',
        'workspace.widgets.quickOrder.header.title',
      ])
    )
    expect(allReport.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.widgets.inlineWidget.body.bodyOnly' }),
        expect.objectContaining({ pathKey: 'workspace.widgets.inlineWidget.header.title' }),
        expect.objectContaining({ pathKey: 'workspace.widgets.quickOrder.body.submitOrder' }),
        expect.objectContaining({ pathKey: 'workspace.widgets.quickOrder.header.title' }),
      ])
    )
  })

  it('does not report optional-chain monitor error copy as orphaned', () => {
    const projectRoot = createOptionalChainMonitorProject()

    const monitorReport = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    }).report

    expect(monitorReport.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.loadViews' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.createDefaultView' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.invalidViewResponse' }),
      ])
    )
  })

  it('does not report invoked useCallback-wrapped monitor error copy as orphaned', () => {
    const projectRoot = createUseCallbackMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })

    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.loadViews' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.createDefaultView' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.errors.invalidViewResponse' }),
      ])
    )
  })

  ;([
    ['forwardRef', 'forwardRef'],
    ['memo', 'memo'],
    ['memo(forwardRef)', 'memoForwardRef'],
  ] as const).forEach(([label, wrapper]) => {
    it(`does not report ${label}-wrapped exported component copy as orphaned`, () => {
      const projectRoot = createWrappedExportMonitorProject(wrapper)

      const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
        withOrphans: true,
      })

      expect(report.usedKeys).toContain('workspace.monitor.used')
      expect(report.orphanedKeys).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.used' })])
      )
    })
  })

  it('does not mark copy as used from useCallback closures that are never invoked', () => {
    const projectRoot = createUnusedUseCallbackMonitorProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )

    expect(getCoveragePathKeys(scanResult)).not.toContain('workspace.monitor.orphan')
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it('does not report verify promise callback error copy as orphaned', () => {
    const projectRoot = createVerifyPromiseProject()

    const { report } = buildRouteReport(projectRoot, '/verify', { withOrphans: true })
    const expectedKeys = [
      'auth.verify.errors.expired',
      'auth.verify.errors.invalid',
      'auth.verify.errors.attempts',
      'auth.verify.errors.generic',
      'auth.verify.errors.resendFailed',
    ]

    expect(report.usedKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('propagates copy usage through helpers and child components without protecting the whole root', () => {
    const projectRoot = createCopyPassThroughMonitorProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )

    expect(getCoveragePathKeys(scanResult)).toContain('workspace.monitor.errors')
    expect(report.dynamicProtectedRoots).not.toContain('workspace.monitor')
    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it("resolves ReturnType<typeof ...>['copy'] parameter descriptors through useMemo callbacks", () => {
    const projectRoot = createReturnTypeMonitorProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )
    const expectedKeys = [
      'workspace.monitor.configSearch.activeMonitors',
      'workspace.monitor.configSearch.pausedMonitors',
      'workspace.monitor.configSearch.lastOutcome',
      'workspace.monitor.configSearch.hasLastExecution',
      'workspace.monitor.configSearch.noLastExecution',
      'workspace.monitor.configSearch.hasLastOutcome',
      'workspace.monitor.configSearch.noLastOutcome',
      'workspace.monitor.configSearch.hasLastExecutionLog',
      'workspace.monitor.configSearch.noLastExecutionLog',
    ]

    expect(getCoveragePathKeys(scanResult)).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('does not report array built-ins as missing keys when array copy is passed through props', () => {
    const projectRoot = createArrayBuiltinProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor')

    expect(report.usedKeys).toEqual(
      expect.arrayContaining(['workspace.monitor.nextSteps.0', 'workspace.monitor.nextSteps.1'])
    )
    expect(report.missingKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.monitor.nextSteps.length' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.nextSteps.map' }),
      ])
    )
  })

  it('does not report string consumer methods on copy leaves as missing keys', () => {
    const projectRoot = createStringMethodMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor')

    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.monitor.label',
        'workspace.monitor.noItemsFound',
        'workspace.monitor.pages',
      ])
    )
    expect(report.missingKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.monitor.label.toLowerCase' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.pages.toLowerCase' }),
      ])
    )
  })

  it('ignores createTranslator calls without a static namespace when formatting inline templates', () => {
    const projectRoot = createInlineFormatterProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor')

    expect(report.missingKeys).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'value' })])
    )
  })

  it('does not mark copy as used from local helpers that are never invoked', () => {
    const projectRoot = createUnusedHelperMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })

    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it('does not mark copy as used from exported helpers that are never reached in all mode', () => {
    const projectRoot = createUnusedExportedHelperMonitorProject()

    const { scanResult, report } = buildAllReport(projectRoot, { withOrphans: true })

    expect(scanResult.scannedFiles).not.toContain(
      'app/workspace/[workspaceId]/monitor/unused-helper.tsx'
    )
    expect(getCoveragePathKeys(scanResult)).not.toContain('workspace.monitor.orphan')
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it('includes route-reachable localized and non-localized boundaries in route reports', () => {
    const projectRoot = createRouteBoundaryProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )

    expect(scanResult.scannedFiles).toEqual(
      expect.arrayContaining([
        'app/[locale]/not-found.tsx',
        'app/workspace/[workspaceId]/error.tsx',
        'app/workspace/[workspaceId]/monitor/global-error.tsx',
      ])
    )
    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'notFound.title',
        'notFound.description',
        'workspace.monitor.boundary.errorTitle',
        'workspace.monitor.boundary.globalErrorTitle',
      ])
    )
  })

  it('expands dynamic subtree coverage into target locale gaps', () => {
    const projectRoot = createDynamicLocaleGapProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })

    expect(report.dynamicProtectedRoots).toContain('workspace.monitor.values')
    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'workspace.monitor.values.running',
        'workspace.monitor.values.paused',
      ])
    )
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.monitor.values.running' }),
        expect.objectContaining({ pathKey: 'workspace.monitor.values.paused' }),
      ])
    )
    const pausedGapLocales = report.targetLocaleGaps
      .filter((entry) => entry.pathKey === 'workspace.monitor.values.paused')
      .map((entry) => entry.locale)
      .sort()
    const expectedTargetLocales = locales.filter((locale) => locale !== defaultLocale).sort()

    expect(pausedGapLocales).toEqual(expectedTargetLocales)
  })

  it('does not report timer callback copy usage as orphaned', () => {
    const projectRoot = createTimerCallbackMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })
    const expectedKeys = [
      'workspace.monitor.errors.loadViews',
      'workspace.monitor.errors.createDefaultView',
      'workspace.monitor.errors.invalidViewResponse',
    ]

    expect(report.usedKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('does not report startTransition callback copy usage as orphaned', () => {
    const projectRoot = createStartTransitionMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })
    const expectedKeys = [
      'workspace.monitor.errors.loadViews',
      'workspace.monitor.errors.createDefaultView',
    ]

    expect(report.usedKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('does not report invoked render-prop copy usage as orphaned', () => {
    const projectRoot = createRenderPropMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })
    const expectedKeys = [
      'workspace.monitor.timezone.label',
      'workspace.monitor.timezone.loading',
      'workspace.monitor.timezone.empty',
      'workspace.monitor.timezone.placeholder',
    ]

    expect(report.usedKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('does not report imported render-prop callback copy usage as orphaned', () => {
    const projectRoot = createImportedRenderPropMonitorProject()

    const { report } = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    })
    const expectedKeys = [
      'workspace.monitor.timezone.label',
      'workspace.monitor.timezone.empty',
      'workspace.monitor.timezone.loading',
    ]

    expect(report.usedKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining(expectedKeys.map((pathKey) => expect.objectContaining({ pathKey })))
    )
  })

  it('does not mark unused render props as used when the child never invokes them', () => {
    const projectRoot = createUnusedRenderPropMonitorProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )

    expect(getCoveragePathKeys(scanResult)).not.toContain('workspace.monitor.orphan')
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it('does not mark imported render props as used when the child never invokes them', () => {
    const projectRoot = createUnusedImportedRenderPropMonitorProject()

    const { scanResult, report } = buildRouteReport(
      projectRoot,
      '/workspace/[workspaceId]/monitor',
      {
        withOrphans: true,
      }
    )

    expect(getCoveragePathKeys(scanResult)).not.toContain('workspace.monitor.orphan')
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
  })

  it('tracks localized not-found entry copy in all mode', () => {
    const projectRoot = createNotFoundAllModeProject()

    const { scanResult, report } = buildAllReport(projectRoot, { withOrphans: true })

    expect(scanResult.scannedFiles).toEqual(
      expect.arrayContaining(['app/[locale]/not-found.tsx', 'app/not-found-content.tsx'])
    )
    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'notFound.title',
        'notFound.description',
        'notFound.returnHome',
        'notFound.supportPrefix',
        'notFound.supportLinkLabel',
      ])
    )
    expect(report.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'notFound.title' }),
        expect.objectContaining({ pathKey: 'notFound.description' }),
        expect.objectContaining({ pathKey: 'notFound.returnHome' }),
        expect.objectContaining({ pathKey: 'notFound.supportPrefix' }),
        expect.objectContaining({ pathKey: 'notFound.supportLinkLabel' }),
      ])
    )
  })

  it('tracks non-localized framework entry files in all mode', () => {
    const projectRoot = createLoadingAllModeProject()

    const { scanResult, report } = buildAllReport(projectRoot, { withOrphans: true })

    expect(scanResult.scannedFiles).toContain('app/workspace/[workspaceId]/loading.tsx')
    expect(report.usedKeys).toEqual(
      expect.arrayContaining(['workspace.loading.title', 'workspace.loading.description'])
    )
    expect(report.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.loading.orphan' })])
    )
  })

  it('tracks landing array roots and expands them to used leaves', () => {
    const projectRoot = createLandingArrayProject()

    const { scanResult, report } = buildRouteReport(projectRoot, '/', {
      withOrphans: true,
    })

    expect(getCoveragePathKeys(scanResult)).toEqual(
      expect.arrayContaining([
        'landing.hero.featureBadges.0',
        'landing.hero.leadWords',
        'landing.features.rows',
        'landing.howItWorks.processes',
      ])
    )
    expect(report.usedKeys).toEqual(
      expect.arrayContaining([
        'landing.hero.featureBadges.0',
        'landing.hero.leadWords.0',
        'landing.hero.leadWords.1',
        'landing.features.rows.0.title',
        'landing.features.rows.0.bullets.0',
        'landing.features.rows.0.bullets.1',
        'landing.howItWorks.processes.0.title',
        'landing.howItWorks.processes.0.description',
      ])
    )
    expect(report.usedKeys).not.toContain('landing.hero.featureBadges.1')
    expect(report.usedKeys).not.toContain('landing.hero.featureBadges.2')
    expect(report.targetLocaleGaps).toEqual(
      expect.arrayContaining([{ locale: 'es', pathKey: 'landing.hero.leadWords.1' }])
    )
    expect(report.targetLocaleGaps).not.toEqual(
      expect.arrayContaining([{ locale: 'es', pathKey: 'landing.hero.featureBadges.1' }])
    )
  })

  it('derives owned namespaces for concrete and canonical catch-all routes', () => {
    expect(getRouteOwnedNamespaces('/blog/hello-world')).toEqual(['blog', 'meta.blog'])
    expect(deriveRouteNamespace('/blog/hello-world')).toBe('blog')
    expect(getRouteOwnedNamespaces('/error')).toEqual(['auth.common', 'auth.error', 'auth.sso'])
    expect(deriveRouteNamespace('/error')).toBe('auth.error')
    expect(deriveRouteNamespace('/error/callback')).toBe('auth.error')
    expect(getRouteOwnedNamespaces('/missing')).toEqual(['notFound'])
    expect(getRouteOwnedNamespaces('/missing/deep')).toEqual(['notFound'])
    expect(deriveRouteNamespace('/missing/deep')).toBe('notFound')
    expect(getRouteOwnedNamespaces('/error/[[...callback]]')).toEqual([
      'auth.common',
      'auth.error',
      'auth.sso',
    ])
    expect(deriveRouteNamespace('/error/[[...callback]]')).toBe('auth.error')
    expect(getRouteOwnedNamespaces('/[...notFound]')).toEqual(['notFound'])
    expect(deriveRouteNamespace('/[...notFound]')).toBe('notFound')
  })

  it('builds read-only reports without mutating source or locale files', () => {
    const projectRoot = createTempProject({
      'i18n/messages/en.json': createLocaleMessages(),
      'i18n/messages/es.json': createLocaleMessages(),
      'i18n/messages/zh.json': createLocaleMessages(),
      'app/[locale]/(landing)/privacy/page.tsx': `
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Hardcoded privacy title',
    description: 'Hardcoded privacy description',
  }
}

export default function PrivacyPage() {
  return <div />
}
`,
      'app/[locale]/workspace/[workspaceId]/layout.tsx':
        'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/[locale]/workspace/[workspaceId]/templates/page.tsx':
        "import { TemplatesPage } from '@/app/workspace/[workspaceId]/templates/templates'\nexport default function Page(){ return <TemplatesPage /> }\n",
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'
import { useTranslations } from 'next-intl'

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')
  return <button title="Run now">{t('used')}</button>
}
`,
      'app/workspace/[workspaceId]/templates/templates.tsx': `
'use client'
import { useTranslations } from 'next-intl'

export function TemplatesPage() {
  const t = useTranslations('workspace.templates')
  return <div>{t('used')}</div>
}
`,
    })

    const trackedFiles = [
      'i18n/messages/en.json',
      'i18n/messages/es.json',
      'i18n/messages/zh.json',
      'app/[locale]/(landing)/privacy/page.tsx',
      'app/workspace/[workspaceId]/monitor/monitor.tsx',
      'app/workspace/[workspaceId]/templates/templates.tsx',
    ]
    const before = snapshotFiles(projectRoot, trackedFiles)

    const privacyReport = buildRouteReport(projectRoot, '/privacy', {
      withOrphans: true,
    }).report
    const monitorReport = buildRouteReport(projectRoot, '/workspace/[workspaceId]/monitor', {
      withOrphans: true,
    }).report

    expect(privacyReport.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Hardcoded privacy title',
          namespace: 'meta.privacy',
          metadata: true,
        }),
      ])
    )
    expect(monitorReport.orphanedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ pathKey: 'workspace.monitor.orphan' })])
    )
    expect(monitorReport.orphanedKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pathKey: 'workspace.templates.otherOrphan' }),
      ])
    )
    expect(monitorReport.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Run now',
          namespace: 'workspace.monitor',
          suggestedPathKey: 'workspace.monitor.runNow',
        }),
      ])
    )
    expect(snapshotFiles(projectRoot, trackedFiles)).toEqual(before)
  })

  it('reuses existing catalog keys for exact hardcoded metadata matches', () => {
    const messages = parseLocaleMessages()
    messages.meta.privacy.title = 'Hardcoded privacy title'
    const projectRoot = createTempProject({
      'i18n/messages/en.json': toJson(messages),
      'i18n/messages/es.json': toJson(messages),
      'i18n/messages/zh.json': toJson(messages),
      'app/[locale]/(landing)/privacy/page.tsx': `
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Hardcoded privacy title',
  }
}

export default function PrivacyPage() {
  return <div />
}
`,
    })

    const { report } = buildRouteReport(projectRoot, '/privacy')
    const candidate = report.hardcodedCandidates.find(
      (entry) => entry.text === 'Hardcoded privacy title'
    )

    expect(candidate?.existingPathKey).toBe('meta.privacy.title')
  })

  it('reuses route-owned shared catalog keys for exact hardcoded matches', () => {
    const messages = parseLocaleMessages()
    messages.legal = {
      common: {
        contactSupport: 'Contact support',
      },
      privacy: {
        title: 'Privacy title',
      },
    }
    const localeMessages = toJson(messages)
    const projectRoot = createTempProject({
      'i18n/messages/en.json': localeMessages,
      'i18n/messages/es.json': localeMessages,
      'i18n/messages/zh.json': localeMessages,
      'app/[locale]/(landing)/privacy/page.tsx': `
import { useTranslations } from 'next-intl'

export default function PrivacyPage() {
  const t = useTranslations('legal.privacy')

  return <button title="Contact support">{t('title')}</button>
}
`,
    })

    const { report } = buildRouteReport(projectRoot, '/privacy')
    const candidate = report.hardcodedCandidates.find((entry) => entry.text === 'Contact support')

    expect(candidate?.existingPathKey).toBe('legal.common.contactSupport')
  })

  it('does not reuse unrelated cross-namespace keys for all-mode hardcoded candidates', () => {
    const messages = parseLocaleMessages()
    messages.legal = {
      common: {
        contactSupport: 'Contact support',
      },
    }
    const localeMessages = toJson(messages)
    const projectRoot = createTempProject({
      'i18n/messages/en.json': localeMessages,
      'i18n/messages/es.json': localeMessages,
      'i18n/messages/zh.json': localeMessages,
      'app/[locale]/page.tsx': `
import { MonitorPage } from '@/app/monitor-page'

export default function Page() {
  return <MonitorPage />
}
`,
      'app/monitor-page.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')

  return <button title="Contact support">{t('used')}</button>
}
`,
    })

    const { report } = buildAllReport(projectRoot)
    const candidate = report.hardcodedCandidates.find((entry) => entry.text === 'Contact support')

    expect(candidate?.existingPathKey).toBeUndefined()
  })

  it('generates lower-camel fallback suggestions for ownership-based metadata candidates', () => {
    const messages = parseLocaleMessages()
    messages.meta.landing = {
      title: 'Landing title',
      description: 'Landing description',
    }
    const projectRoot = createTempProject({
      'i18n/messages/en.json': toJson(messages),
      'i18n/messages/es.json': toJson(messages),
      'i18n/messages/zh.json': toJson(messages),
      'app/[locale]/(landing)/page.tsx': `
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Fresh landing title',
  }
}

export default function LandingPage() {
  return <div />
}
`,
    })

    const { report } = buildRouteReport(projectRoot, '/')
    const candidate = report.hardcodedCandidates.find(
      (entry) => entry.text === 'Fresh landing title'
    )

    expect(candidate?.suggestedPathKey).toBe('meta.landing.freshLandingTitle')
    expect(candidate?.suggestedPathKey).not.toContain('.Landing.')
  })

  it('normalizes report file paths to project-relative output', () => {
    const messages = parseLocaleMessages()
    messages.legal = {
      common: {
        contactSupport: 'Contact support',
      },
      privacy: {
        title: 'Privacy title',
      },
    }
    const localeMessages = toJson(messages)
    const projectRoot = createTempProject({
      'i18n/messages/en.json': localeMessages,
      'i18n/messages/es.json': localeMessages,
      'i18n/messages/zh.json': localeMessages,
      'app/[locale]/(landing)/privacy/page.tsx': `
import { useTranslations } from 'next-intl'

export default function PrivacyPage() {
  const t = useTranslations('legal.privacy')

  return <button title="Hardcoded privacy action">{t('missingLabel')}</button>
}
`,
    })

    const { report } = buildRouteReport(projectRoot, '/privacy')
    const missingKey = report.missingKeys.find(
      (entry) => entry.pathKey === 'legal.privacy.missingLabel'
    )
    const candidate = report.hardcodedCandidates.find(
      (entry) => entry.text === 'Hardcoded privacy action'
    )

    expect(missingKey?.filePath).toBe('app/[locale]/(landing)/privacy/page.tsx')
    expect(candidate?.filePath).toBe('app/[locale]/(landing)/privacy/page.tsx')
  })

  it('keeps structured-data-like object literals out of hardcoded candidates', () => {
    const projectRoot = createTempProject({
      'i18n/messages/en.json': createLocaleMessages(),
      'i18n/messages/es.json': createLocaleMessages(),
      'i18n/messages/zh.json': createLocaleMessages(),
      'app/[locale]/(landing)/privacy/page.tsx': `
import type { Metadata } from 'next'

const structuredData = {
  name: 'Hardcoded organization name',
  description: 'Hardcoded organization description',
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Hardcoded privacy title',
    description: 'Hardcoded privacy description',
  }
}

export default function PrivacyPage() {
  return <script type='application/ld+json'>{JSON.stringify(structuredData)}</script>
}
`,
    })

    const { report } = buildRouteReport(projectRoot, '/privacy')

    expect(report.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Hardcoded privacy title', metadata: true }),
        expect.objectContaining({ text: 'Hardcoded privacy description', metadata: true }),
      ])
    )
    expect(report.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Hardcoded organization name' }),
        expect.objectContaining({ text: 'Hardcoded organization description' }),
      ])
    )
  })
})
