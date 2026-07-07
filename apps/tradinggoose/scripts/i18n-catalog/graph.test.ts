import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverAllModeEntries, resolveRouteEntries } from './entries'
import { scanCatalogProject } from './scan'
import {
  cleanupTempProjects,
  createAppRootGlobalBoundaryProject,
  createConcreteRouteResolutionProject,
  createLocaleMessages,
  createRouteBoundaryProject,
  createTempProject,
  getCoveragePathKeys,
} from './test-utils'

afterEach(cleanupTempProjects)

describe('i18n catalog entry discovery', () => {
  it('discovers real framework entry basenames in all mode', () => {
    const projectRoot = createTempProject({
      'i18n/messages/en.json': createLocaleMessages(),
      'i18n/messages/es.json': createLocaleMessages(),
      'i18n/messages/zh.json': createLocaleMessages(),
      'app/[locale]/layout.tsx': 'export default function Layout() { return null }\n',
      'app/[locale]/page.tsx': 'export default function Page() { return null }\n',
      'app/[locale]/not-found.tsx': 'export default function NotFound() { return null }\n',
      'app/workspace/[workspaceId]/loading.tsx':
        'export default function Loading() { return null }\n',
      'app/workspace/[workspaceId]/default.tsx':
        'export default function Default() { return null }\n',
    })

    const entries = discoverAllModeEntries(projectRoot)
    const relativeEntryFiles = entries.entryFiles.map((filePath) =>
      path.relative(projectRoot, filePath)
    )

    expect(relativeEntryFiles).toEqual(
      expect.arrayContaining([
        'app/[locale]/layout.tsx',
        'app/[locale]/page.tsx',
        'app/[locale]/not-found.tsx',
        'app/workspace/[workspaceId]/loading.tsx',
      ])
    )
    expect(relativeEntryFiles).not.toContain('app/workspace/[workspaceId]/default.tsx')
  })

  it('resolves concrete dynamic and catch-all pathnames to canonical route patterns', () => {
    const projectRoot = createConcreteRouteResolutionProject()

    expect(resolveRouteEntries(projectRoot, '/blog/hello-world').routePath).toBe('/blog/[slug]')
    expect(resolveRouteEntries(projectRoot, '/workspace/ws-1/monitor').routePath).toBe(
      '/workspace/[workspaceId]/monitor'
    )
    expect(resolveRouteEntries(projectRoot, '/error').routePath).toBe('/error/[[...callback]]')
    expect(resolveRouteEntries(projectRoot, '/missing/deep').routePath).toBe('/[...notFound]')
    expect(resolveRouteEntries(projectRoot, '/workspace/[workspaceId]/monitor').routePath).toBe(
      '/workspace/[workspaceId]/monitor'
    )
  })

  it('includes localized and route-owned boundary entries for route scans', () => {
    const projectRoot = createRouteBoundaryProject()

    const entries = resolveRouteEntries(projectRoot, '/workspace/ws-1/monitor')
    const relativeEntryFiles = entries.entryFiles.map((filePath) =>
      path.relative(projectRoot, filePath)
    )

    expect(relativeEntryFiles).toEqual(
      expect.arrayContaining([
        'app/[locale]/layout.tsx',
        'app/[locale]/workspace/[workspaceId]/layout.tsx',
        'app/[locale]/workspace/[workspaceId]/monitor/page.tsx',
        'app/[locale]/not-found.tsx',
        'app/workspace/[workspaceId]/error.tsx',
        'app/workspace/[workspaceId]/monitor/global-error.tsx',
      ])
    )
  })

  it('includes app-root global boundaries for route scans', () => {
    const projectRoot = createAppRootGlobalBoundaryProject()

    const entries = resolveRouteEntries(projectRoot, '/workspace/ws-1/monitor')
    const relativeEntryFiles = entries.entryFiles.map((filePath) =>
      path.relative(projectRoot, filePath)
    )

    expect(relativeEntryFiles).toContain('app/global-error.tsx')
  })
})

describe('i18n catalog graph reachability', () => {
  it('does not follow type-only imports into the runtime route graph', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/layout.tsx':
        'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
import type { MonitorProps } from '@/app/workspace/[workspaceId]/monitor/types'

export function MonitorPage(_props: MonitorProps) {
  return <button title="Run now" />
}
`,
      'app/workspace/[workspaceId]/monitor/types.ts': `
import { DialogContent } from '@/components/ui/dialog'

export type MonitorProps = {
  dialog?: typeof DialogContent
}
`,
      'components/ui/dialog.tsx': `
export function DialogContent({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {children}
      <span className='sr-only'>Close</span>
    </div>
  )
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toContain('app/workspace/[workspaceId]/monitor/monitor.tsx')
    expect(result.scannedFiles).not.toContain('app/workspace/[workspaceId]/monitor/types.ts')
    expect(result.scannedFiles).not.toContain('components/ui/dialog.tsx')
    expect(result.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Run now',
          namespace: 'workspace.monitor',
        }),
      ])
    )
  })

  it('skips repo-root app/api, __tests__, and __mocks__ files in all-project scans', () => {
    const projectRoot = createTempProject({
      'i18n/messages/en.json': createLocaleMessages(),
      'i18n/messages/es.json': createLocaleMessages(),
      'i18n/messages/zh.json': createLocaleMessages(),
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        'export default function Page(){ return <div>Hello</div> }\n',
      'app/api/admin/services/route.ts':
        "export function GET() { return Response.json({ label: 'Nope' }) }\n",
      '__tests__/root.tsx': 'export function RootTest() { return <span>Ignored</span> }\n',
      '__mocks__/next-intl.ts': "export const mocked = 'ignored'\n",
      'components/__tests__/dialog.tsx':
        'export function DialogText() { return <span>Ignored nested</span> }\n',
    })

    const result = scanCatalogProject({
      mode: 'all',
      projectRoot,
    })

    expect(result.scannedFiles).toContain('app/[locale]/workspace/[workspaceId]/monitor/page.tsx')
    expect(result.scannedFiles).not.toContain('app/api/admin/services/route.ts')
    expect(result.scannedFiles).not.toContain('__tests__/root.tsx')
    expect(result.scannedFiles).not.toContain('__mocks__/next-intl.ts')
    expect(result.scannedFiles).not.toContain('components/__tests__/dialog.tsx')
  })

  it('follows runtime re-exports through barrels during route scans', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/layout.tsx': `
import { GlobalNavbar } from '@/global-navbar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <GlobalNavbar>{children}</GlobalNavbar>
}
`,
      'app/[locale]/workspace/[workspaceId]/dashboard/page.tsx':
        "import { DashboardPage } from '@/app/workspace/[workspaceId]/dashboard/dashboard'\nexport default function Page(){ return <DashboardPage /> }\n",
      'app/workspace/[workspaceId]/dashboard/dashboard.tsx':
        'export function DashboardPage() { return <div>Dashboard body</div> }\n',
      'global-navbar/index.ts':
        "export { GlobalNavbar } from './global-navbar'\nexport { StrayNavbar } from './stray-navbar'\n",
      'global-navbar/global-navbar.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function GlobalNavbar({ children }: { children: React.ReactNode }) {
  const t = useTranslations('workspace.nav')
  return (
    <nav aria-label={t('workspace.dashboard')}>
      {children}
    </nav>
  )
}
`,
      'global-navbar/stray-navbar.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function StrayNavbar() {
  const t = useTranslations('workspace.monitor')
  return <aside>{t('stray')}</aside>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/dashboard',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining(['global-navbar/index.ts', 'global-navbar/global-navbar.tsx'])
    )
    expect(result.scannedFiles).not.toContain('global-navbar/stray-navbar.tsx')
    expect(getCoveragePathKeys(result)).toContain('workspace.nav.workspace.dashboard')
    expect(getCoveragePathKeys(result)).not.toContain('workspace.monitor.stray')
  })

  it('only follows requested named barrel re-exports during route scans', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx': `
import { UsedWidget } from '@/widgets'

export default function Page() {
  return <UsedWidget />
}
`,
      'widgets/index.ts':
        "export { UsedWidget } from './used'\nexport { StrayWidget } from './stray'\n",
      'widgets/used.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function UsedWidget() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('used')}</div>
}
`,
      'widgets/stray.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function StrayWidget() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('stray')}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining(['widgets/index.ts', 'widgets/used.tsx'])
    )
    expect(result.scannedFiles).not.toContain('widgets/stray.tsx')
    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.used')
    expect(getCoveragePathKeys(result)).not.toContain('workspace.monitor.stray')
  })

  it('ignores type-only barrel re-exports in route reachability', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx': `
import '@/barrel'

export default function Page() {
  return <div>Monitor</div>
}
`,
      'barrel.ts': "export type { DialogProps } from '@/components/ui/dialog'\n",
      'components/ui/dialog.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export type DialogProps = {
  title: string
}

export function Dialog() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('stray')}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toContain('barrel.ts')
    expect(result.scannedFiles).not.toContain('components/ui/dialog.tsx')
    expect(getCoveragePathKeys(result)).not.toContain('workspace.monitor.stray')
  })

  it('only scans imported exports from chat-style multi-export barrels', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/chat/[identifier]/page.tsx': `
import { ChatHeader, VoiceInterface } from '@/app/chat/components'

export default function Page() {
  return (
    <>
      <ChatHeader />
      <VoiceInterface />
    </>
  )
}
`,
      'app/chat/components/index.ts': `
export { default as EmailAuth } from './auth/email/email-auth'
export { ChatHeader } from './header/header'
export { ChatLoadingState } from './loading-state/loading-state'
export type { ChatMessage } from './message/message'
export { ChatMessageContainer } from './message-container/message-container'
export { VoiceInterface } from './voice-interface/voice-interface'
`,
      'app/chat/components/auth/email/email-auth.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function EmailAuth() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('emailAuthOnly')}</div>
}
`,
      'app/chat/components/header/header.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function ChatHeader() {
  const t = useTranslations('workspace.monitor')
  return <header>{t('title')}</header>
}
`,
      'app/chat/components/loading-state/loading-state.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function ChatLoadingState() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('loadingOnly')}</div>
}
`,
      'app/chat/components/message/message.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export type ChatMessage = {
  id: string
}

export function MessagePreview() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('messageOnly')}</div>
}
`,
      'app/chat/components/message-container/message-container.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function ChatMessageContainer() {
  const t = useTranslations('workspace.monitor')
  return <section>{t('containerOnly')}</section>
}
`,
      'app/chat/components/voice-interface/voice-interface.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function VoiceInterface() {
  const t = useTranslations('workspace.monitor')
  return <div>{t('used')}</div>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/chat/[identifier]',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining([
        'app/chat/components/index.ts',
        'app/chat/components/header/header.tsx',
        'app/chat/components/voice-interface/voice-interface.tsx',
      ])
    )
    expect(result.scannedFiles).not.toEqual(
      expect.arrayContaining([
        'app/chat/components/auth/email/email-auth.tsx',
        'app/chat/components/loading-state/loading-state.tsx',
        'app/chat/components/message/message.tsx',
        'app/chat/components/message-container/message-container.tsx',
      ])
    )
    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining(['workspace.monitor.title', 'workspace.monitor.used'])
    )
    expect(getCoveragePathKeys(result)).not.toEqual(
      expect.arrayContaining([
        'workspace.monitor.emailAuthOnly',
        'workspace.monitor.loadingOnly',
        'workspace.monitor.messageOnly',
        'workspace.monitor.containerOnly',
      ])
    )
  })
})
