import { afterEach, describe, expect, it } from 'vitest'
import { scanCatalogProject } from './scan'
import {
  cleanupTempProjects,
  createAllModeAliasNamespaceProject,
  createAllModeOwnershipProject,
  createAppRootGlobalBoundaryProject,
  createBaseProject,
  createLocaleMessages,
  createSharedAdminRouteProject,
  createTempProject,
  getCoveragePathKeys,
  matchesProjectFilePath,
} from './test-utils'

afterEach(cleanupTempProjects)

describe('i18n catalog scanner integration', () => {
  it('resolves localized wrappers and extracts translations, aliases, and dynamic protection', () => {
    const projectRoot = createBaseProject()
    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toContain('app/[locale]/workspace/[workspaceId]/monitor/layout.tsx')
    expect(result.scannedFiles).toContain('app/[locale]/workspace/[workspaceId]/monitor/page.tsx')
    expect(result.scannedFiles).toContain('app/workspace/[workspaceId]/monitor/monitor.tsx')
    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.title',
        'workspace.monitor.fields.status',
        'workspace.monitor.layoutBadge',
      ])
    )
    expect(
      getCoveragePathKeys(result, { mode: 'subtree', subtreeReason: 'dynamic-root' })
    ).toContain('workspace.monitor.values')
    expect(result.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Run now',
          namespace: 'workspace.monitor',
        }),
        expect.objectContaining({
          text: 'Monitor shell',
          namespace: 'workspace.monitor',
        }),
      ])
    )
  })

  it('scans the root locale layout when it owns route copy', () => {
    const messages = JSON.stringify(
      {
        workspace: {
          monitor: {
            rootLayoutBadge: 'Root layout badge',
          },
        },
      },
      null,
      2
    )
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/layout.tsx': `
import { useTranslations } from 'next-intl'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('workspace.monitor')

  return (
    <section title="Shell badge">
      <div>{t('rootLayoutBadge')}</div>
      {children}
    </section>
  )
}
`,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
        "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
      'app/workspace/[workspaceId]/monitor/monitor.tsx':
        'export function MonitorPage() { return <div /> }\n',
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toContain('app/[locale]/layout.tsx')
    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.rootLayoutBadge')
    expect(result.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Shell badge',
          namespace: 'workspace.monitor',
        }),
      ])
    )
  })

  it('does not assign shared ui or email literals to the active route fallback namespace', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/layout.tsx':
        'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx': `
import { getSession } from '@/lib/auth'
import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'

export default async function Page() {
  await getSession()
  return <MonitorPage />
}
`,
      'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { DialogContent } from '@/components/ui/dialog'

export function MonitorPage() {
  return (
    <DialogContent>
      <button title="Run now" />
    </DialogContent>
  )
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
      'lib/auth.ts': `
import { renderSomething } from '@/components/emails/render-email'

export async function getSession() {
  return renderSomething ? { user: { id: '1' } } : null
}
`,
      'components/emails/render-email.ts': `
import { LocalizedEmail } from '@/components/emails/localized-email'

export const renderSomething = LocalizedEmail
`,
      'components/emails/localized-email.tsx': `
import EmailFooter from '@/components/emails/footer'

export function LocalizedEmail() {
  return (
    <div>
      <EmailFooter />
    </div>
  )
}
`,
      'components/emails/footer.tsx': `
export default function EmailFooter() {
  return <a>Discord</a>
}
`,
    })

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining(['components/ui/dialog.tsx', 'components/emails/footer.tsx'])
    )
    expect(result.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Run now',
          namespace: 'workspace.monitor',
        }),
      ])
    )
    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Close' })])
    )
    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Discord' })])
    )
  })

  it('scans app-root global boundaries without widening route fallback to shared files', () => {
    const projectRoot = createAppRootGlobalBoundaryProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining(['app/global-error.tsx', 'components/shared-label.tsx'])
    )
    expect(getCoveragePathKeys(result)).toContain('workspace.monitor.boundary.rootGlobalErrorTitle')
    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Shared label' })])
    )
  })

  it('suppresses all-mode hardcoded candidates for shared non-app files without static namespaces', () => {
    const projectRoot = createAllModeOwnershipProject()

    const result = scanCatalogProject({
      mode: 'all',
      projectRoot,
    })

    expect(result.scannedFiles).toEqual(
      expect.arrayContaining([
        'app/workspace/[workspaceId]/monitor/monitor-route-panel.tsx',
        'components/shared-label.tsx',
      ])
    )
    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Shared label' })])
    )
  })

  it('derives all-mode fallback namespaces from concrete app routes', () => {
    const projectRoot = createAllModeOwnershipProject()

    const result = scanCatalogProject({
      mode: 'all',
      projectRoot,
    })

    expect(result.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Run now',
          namespace: 'workspace.monitor',
        }),
      ])
    )
  })

  it('attributes shared app admin hardcoded copy to the active route in route mode', () => {
    const projectRoot = createSharedAdminRouteProject()

    const integrationsResult = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/admin/integrations',
    })
    const servicesResult = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/admin/services',
    })

    expect(integrationsResult.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          text: 'Save',
          namespace: 'admin.integrations',
        }),
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          text: 'Edit',
          namespace: 'admin.integrations',
        }),
      ])
    )
    expect(servicesResult.hardcodedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          text: 'Save',
          namespace: 'admin.services',
        }),
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          text: 'Edit',
          namespace: 'admin.services',
        }),
      ])
    )
    expect(integrationsResult.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          namespace: 'admin.home',
        }),
      ])
    )
    expect(servicesResult.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: expect.stringMatching(/\/app\/admin\/admin-inline-secret-field\.tsx$/),
          namespace: 'admin.home',
        }),
      ])
    )
  })

  it('keeps per-route namespaces for shared app admin copy in all mode', () => {
    const projectRoot = createSharedAdminRouteProject()

    const result = scanCatalogProject({
      mode: 'all',
      projectRoot,
    })

    const saveNamespaces = result.hardcodedCandidates
      .filter(
        (entry) =>
          matchesProjectFilePath(entry.filePath, 'app/admin/admin-inline-secret-field.tsx') &&
          entry.text === 'Save'
      )
      .map((entry) => entry.namespace)
      .sort()

    expect(saveNamespaces).toEqual(['admin.integrations', 'admin.services'])
  })

  it('dedupes identical all-mode hardcoded candidates for alias routes sharing a namespace', () => {
    const projectRoot = createAllModeAliasNamespaceProject()

    const result = scanCatalogProject({
      mode: 'all',
      projectRoot,
    })

    const refreshCandidates = result.hardcodedCandidates.filter(
      (entry) =>
        matchesProjectFilePath(entry.filePath, 'app/admin/billing/billing-notice.tsx') &&
        entry.text === 'Refresh catalog'
    )

    expect(refreshCandidates).toEqual([
      expect.objectContaining({
        namespace: 'admin.billing',
      }),
    ])
  })
})
