import { afterEach, describe, expect, it } from 'vitest'
import { scanCatalogProject } from './scan'
import {
  cleanupTempProjects,
  createChangelogProject,
  createLocaleMessages,
  createTempProject,
  getCoveragePathKeys,
} from './test-utils'

afterEach(cleanupTempProjects)

describe('i18n catalog scanner semantics', () => {
  it('captures copy access through array callbacks on local type-literal props aliases', () => {
    const projectRoot = createChangelogProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/changelog',
    })

    expect(result.scannedFiles).toContain('app/changelog/components/timeline-list.tsx')
    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'changelog.viewContributorAriaLabel',
        'changelog.contributorAvatarAlt',
        'changelog.loadingMore',
        'changelog.showMore',
      ])
    )
  })

  it('captures copy access through interfaces wrapping imported PublicCopy aliases', () => {
    const projectRoot = createChangelogProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/changelog',
    })

    expect(result.scannedFiles).toContain('app/changelog/components/changelog-content.tsx')
    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'changelog.pageTitle',
        'changelog.viewOnGitHub',
        'changelog.documentation',
        'changelog.rssFeed',
      ])
    )
  })

  it('captures copy access through imported cross-file aliases', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/copy-types.ts': `
import type { Messages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']
`,
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy-types'

export function getStatusLabel(copy: MonitorCopy) {
  return copy.fields.status
}

export function MonitorPage() {
  return <div>{getStatusLabel({} as MonitorCopy)}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toContain('app/workspace/[workspaceId]/monitor/monitor.tsx')
    expect(result.scannedFiles).not.toContain('app/workspace/[workspaceId]/monitor/copy-types.ts')
    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.fields.status')
  })

  it('propagates semantics through local export clauses with the same name', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/copy.ts': `
import { useMessages } from 'next-intl'

function getMonitorCopy() {
  return useMessages().workspace.monitor
}

export { getMonitorCopy }
`,
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { getMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  return <div>{getMonitorCopy().fields.status}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.fields.status')
  })

  it('propagates semantics through renamed local export clauses', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/copy.ts': `
import { useMessages } from 'next-intl'

function getCopy() {
  return useMessages().workspace.monitor
}

export { getCopy as useMonitorCopy }
`,
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  return <div>{useMonitorCopy().fields.status}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.fields.status')
  })

  it('propagates semantics through pass-through local export clauses of imported helpers', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/source.ts': `
import { useMessages } from 'next-intl'

export function getMonitorCopy() {
  return useMessages().workspace.monitor
}
`,
      'app/workspace/[workspaceId]/monitor/copy.ts': `
import { getMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/source'

export { getMonitorCopy as useMonitorCopy }
`,
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  return <div>{useMonitorCopy().fields.status}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining([
        'app/workspace/[workspaceId]/monitor/source.ts',
        'app/workspace/[workspaceId]/monitor/copy.ts',
      ])
    )
    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.fields.status')
  })

  it('propagates semantics through guarded helper locals returned after null checks', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/dashboard/page.tsx':
        "import { DashboardPage } from '@/app/workspace/[workspaceId]/dashboard/page-client'\nexport default function Page(){ return <DashboardPage /> }\n",
      'app/workspace/[workspaceId]/dashboard/page-client.tsx': `
'use client'

import { useSelectorMessages } from '@/i18n/workspace-widget-hooks'

export function DashboardPage() {
  const selectorCopy = useSelectorMessages()
  return <div>{selectorCopy.selectWidget}</div>
}
`,
      'i18n/workspace-widget-hooks.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

type WorkspaceWidgetsMessages = Messages['workspace']['widgets']
export type SelectorMessages = WorkspaceWidgetsMessages['selector']

export function useWorkspaceWidgetsMessages(): WorkspaceWidgetsMessages {
  const widgetsMessages = useMessages().workspace?.widgets

  if (!widgetsMessages) {
    throw new Error('Missing workspace widget messages')
  }

  return widgetsMessages
}

export function useSelectorMessages(): SelectorMessages {
  return useWorkspaceWidgetsMessages().selector
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/dashboard',
    })

    expect(result.scannedFiles).toContain('i18n/workspace-widget-hooks.ts')
    expect(getCoveragePathKeys(result)).toContain('workspace.widgets.selector.selectWidget')
  })
})
