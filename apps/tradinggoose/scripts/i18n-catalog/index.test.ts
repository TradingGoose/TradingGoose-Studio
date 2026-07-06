import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultLocale, locales } from '../../i18n/routing'
import { buildCatalogReport } from './catalog'
import { discoverAllModeEntries, resolveRouteEntries } from './entries'
import { runCatalogCli } from './index'
import { deriveRouteNamespace, getRouteOwnedNamespaces } from './ownership'
import { scanCatalogProject, type CatalogScanResult, type CoverageRecord } from './scan'

const tempRoots: string[] = []

function writeProjectFiles(projectRoot: string, files: Record<string, string>) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(projectRoot, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, contents, 'utf8')
  }
}

function createTempProject(files: Record<string, string>) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-catalog-'))
  tempRoots.push(projectRoot)
  writeProjectFiles(projectRoot, files)
  return projectRoot
}

function matchesProjectFilePath(filePath: string, relativePath: string) {
  return filePath.endsWith(`/${relativePath}`)
}

function createLocaleMessages() {
  return JSON.stringify(
    {
      meta: {
        privacy: {
          title: 'Privacy',
          description: 'Privacy description',
        },
      },
      changelog: {
        pageTitle: 'Changelog',
        viewOnGitHub: 'View on GitHub',
        documentation: 'Documentation',
        rssFeed: 'RSS feed',
        viewContributorAriaLabel: 'View contributor',
        contributorAvatarAlt: 'Contributor avatar',
        loadingMore: 'Loading more',
        showMore: 'Show more',
      },
      notFound: {
        title: 'Not found',
        description: 'Page not found',
        returnHome: 'Return home',
        supportPrefix: 'Need help?',
        supportLinkLabel: 'Contact support',
      },
      workspace: {
        monitor: {
          title: 'Monitor',
          used: 'Used',
          layoutBadge: 'Layout badge',
          orphan: 'Orphan',
          errors: {
            loadViews: 'Unable to load views',
            createDefaultView: 'Unable to create default view',
            invalidViewResponse: 'Invalid saved view response',
          },
          fields: {
            status: 'Status',
          },
          values: {
            running: 'Running',
            paused: 'Paused',
          },
        },
        templates: {
          used: 'Templates used',
          otherOrphan: 'Other orphan',
        },
        nav: {
          workspace: {
            dashboard: 'Dashboard',
            knowledge: 'Knowledge',
            files: 'Files',
            records: 'Records',
            monitor: 'Monitor',
          },
          more: {
            environment: 'Environment',
            apiKeys: 'API Keys',
            integrations: 'Integrations',
          },
          admin: {
            overview: 'Overview',
            billing: 'Billing',
            services: 'Services',
            integrations: 'Integrations',
            registration: 'Registration',
          },
        },
      },
    },
    null,
    2
  )
}

function parseLocaleMessages() {
  return JSON.parse(createLocaleMessages()) as Record<string, any>
}

function toJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function createBaseProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/layout.tsx': `
import { useTranslations } from 'next-intl'

export default function MonitorLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('workspace.monitor')

  return (
    <section title="Monitor shell">
      <div>{t('layoutBadge')}</div>
      {children}
    </section>
  )
}
`,
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/[locale]/workspace/[workspaceId]/templates/page.tsx':
      "import { TemplatesPage } from '@/app/workspace/[workspaceId]/templates/templates'\nexport default function Page(){ return <TemplatesPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}

export function getStatusLabel(copy: MonitorCopy) {
  return copy.fields.status
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useTranslations } from 'next-intl'
import { getStatusLabel, useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')
  const { copy } = useMonitorCopy()
  const mode = 'running'

  return (
    <button title="Run now">
      {t('title')} - {getStatusLabel(copy)} - {copy.values[mode]}
    </button>
  )
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
}

function createChangelogProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'i18n/public-copy.ts': `
import type { Messages } from 'next-intl'

export type PublicCopy = Messages
`,
    'app/[locale]/changelog/page.tsx':
      "import { ChangelogPage } from '@/app/changelog/changelog-page'\nexport default function Page(){ return <ChangelogPage /> }\n",
    'app/changelog/changelog-page.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { ChangelogContent } from '@/app/changelog/components/changelog-content'

export function ChangelogPage() {
  const copy = useMessages().changelog

  return <ChangelogContent copy={copy} locale="en" />
}
`,
    'app/changelog/components/changelog-content.tsx': `
import type { PublicCopy } from '@/i18n/public-copy'
import { TimelineList } from '@/app/changelog/components/timeline-list'

type ChangelogCopy = PublicCopy['changelog']

interface ChangelogContentProps {
  copy: ChangelogCopy
  locale: string
}

export function ChangelogContent({ copy, locale }: ChangelogContentProps) {
  return (
    <section>
      <h1>{copy.pageTitle}</h1>
      <a>{copy.viewOnGitHub}</a>
      <a>{copy.documentation}</a>
      <a>{copy.rssFeed}</a>
      <TimelineList copy={copy} locale={locale} />
    </section>
  )
}
`,
    'app/changelog/components/timeline-list.tsx': `
import type { Messages } from 'next-intl'

type Props = {
  copy: Messages['changelog']
  locale: string
}

export function TimelineList({ copy }: Props) {
  const contributors = ['ada']

  return (
    <section>
      {contributors.map((contributor) => (
        <button key={contributor} aria-label={copy.viewContributorAriaLabel}>
          <img alt={copy.contributorAvatarAlt} />
        </button>
      ))}
      <div>{copy.loadingMore}</div>
      <button>{copy.showMore}</button>
    </section>
  )
}
`,
  })
}

function createOptionalChainMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import type { Messages } from 'next-intl'

type MonitorErrorsCopy = Messages['workspace']['monitor']['errors']

export function MonitorPage({ copy }: { copy?: MonitorErrorsCopy }) {
  return (
    <div>
      <span>{copy?.loadViews}</span>
      <span>{copy?.createDefaultView}</span>
      <span>{copy?.invalidViewResponse}</span>
    </div>
  )
}
`,
  })
}

function createVerifyPromiseProject() {
  const messages = parseLocaleMessages()
  messages.auth = {
    verify: {
      pendingTitle: 'Verify your email',
      errors: {
        attempts: 'Too many attempts',
        expired: 'Verification code expired',
        generic: 'Verification failed',
        invalid: 'Verification code invalid',
        resendFailed: 'Unable to resend code',
      },
    },
  }
  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/(auth)/verify/page.tsx':
      "import { VerifyContent } from '@/app/(auth)/verify/verify-content'\nexport default function Page(){ return <VerifyContent /> }\n",
    'app/(auth)/verify/error-copy.ts': `
import type { Messages } from 'next-intl'

type VerifyCopy = Messages['auth']['verify']

export function getVerificationErrorMessage(copy: VerifyCopy) {
  return [
    copy.errors.expired,
    copy.errors.invalid,
    copy.errors.attempts,
    copy.errors.generic,
  ].join(' ')
}
`,
    'app/(auth)/verify/verify-content.tsx': `
'use client'

import { useEffect } from 'react'
import { useMessages } from 'next-intl'
import { getVerificationErrorMessage } from '@/app/(auth)/verify/error-copy'

export function VerifyContent() {
  const copy = useMessages().auth.verify

  useEffect(() => {
    void Promise.reject(new Error('x')).then(undefined, () => copy.errors.expired)
    void Promise.reject(new Error('x')).catch(() => getVerificationErrorMessage(copy))
  }, [copy])

  function handleResend() {
    void Promise.reject(new Error('x')).catch(() => copy.errors.resendFailed)
  }

  return <button onClick={handleResend}>{copy.pendingTitle}</button>
}
`,
  })
}

function createTimerCallbackMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/scheduler.ts': `
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function scheduleMonitorBootstrap(copy: MonitorCopy) {
  setTimeout(() => copy.errors.loadViews, 0)
  setInterval(() => copy.errors.createDefaultView, 1000)
  queueMicrotask(() => copy.errors.invalidViewResponse)
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useEffect } from 'react'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { scheduleMonitorBootstrap } from '@/app/workspace/[workspaceId]/monitor/scheduler'

export function MonitorPage() {
  const { copy } = useMonitorCopy()

  useEffect(() => {
    scheduleMonitorBootstrap(copy)
  }, [copy])

  return <div>{copy.used}</div>
}
`,
  })
}

function createStartTransitionMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { startTransition, useEffect } from 'react'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  const { copy } = useMonitorCopy()

  useEffect(() => {
    startTransition(() => {
      copy.errors.loadViews
      copy.errors.createDefaultView
    })
  }, [copy])

  return <div>{copy.used}</div>
}
`,
  })
}

function createRenderPropMonitorProject() {
  const messages = parseLocaleMessages()
  messages.workspace.monitor.timezone = {
    empty: 'No timezones found',
    label: 'Timezone',
    loading: 'Loading timezones',
    placeholder: 'Select timezone',
    searchPlaceholder: 'Search timezones',
    triggerLabel: 'Timezone {label}',
  }
  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import { useMessages } from 'next-intl'

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/dropdown.tsx': `
type DropdownOption = {
  label: string
  value: string
}

type DropdownProps = {
  onOpenChange?: (open: boolean) => unknown
  onValueChange: (value: string) => unknown
  renderOption?: (option: DropdownOption, selected: boolean) => React.ReactNode
  renderTriggerValue?: (selected: DropdownOption | null) => React.ReactNode
}

const option = { value: 'UTC', label: 'UTC' }

export function Dropdown(props: DropdownProps) {
  const openResult = props.onOpenChange?.(true)
  const valueResult = props.onValueChange(option.value)

  return (
    <div>
      <div>{props.renderTriggerValue ? props.renderTriggerValue(option) : null}</div>
      <div>{props.renderOption ? props.renderOption(option, true) : null}</div>
      <div>{openResult ?? null}</div>
      <div>{valueResult ?? null}</div>
    </div>
  )
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { Dropdown } from '@/app/workspace/[workspaceId]/monitor/dropdown'

export function MonitorPage() {
  const { copy } = useMonitorCopy()

  return (
    <Dropdown
      onOpenChange={(open) => (open ? copy.timezone.empty : copy.timezone.loading)}
      onValueChange={() => copy.timezone.placeholder}
      renderOption={(option) => <span>{copy.timezone.loading} {option.label}</span>}
      renderTriggerValue={() => <span>{copy.timezone.label}</span>}
    />
  )
}
`,
  })
}

function createImportedRenderPropMonitorProject() {
  const messages = parseLocaleMessages()
  messages.workspace.monitor.timezone = {
    empty: 'No timezones found',
    label: 'Timezone',
    loading: 'Loading timezones',
  }
  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/renderers.tsx': `
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function renderTriggerValue(copy: MonitorCopy) {
  return <span>{copy.timezone.label}</span>
}

export function handleOpenChange(copy: MonitorCopy, open: boolean) {
  return open ? copy.timezone.empty : copy.timezone.loading
}
`,
    'app/workspace/[workspaceId]/monitor/dropdown.tsx': `
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

type DropdownProps = {
  copy: MonitorCopy
  onOpenChange?: (copy: MonitorCopy, open: boolean) => unknown
  renderTriggerValue?: (copy: MonitorCopy) => React.ReactNode
}

export function Dropdown({ copy, onOpenChange, renderTriggerValue }: DropdownProps) {
  const openResult = onOpenChange?.(copy, true)

  return (
    <div>
      <div>{renderTriggerValue ? renderTriggerValue(copy) : null}</div>
      <div>{openResult ?? null}</div>
    </div>
  )
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { Dropdown } from '@/app/workspace/[workspaceId]/monitor/dropdown'
import {
  handleOpenChange,
  renderTriggerValue,
} from '@/app/workspace/[workspaceId]/monitor/renderers'

export function MonitorPage() {
  const { copy } = useMonitorCopy()
  const dropdownProps = {
    copy,
    onOpenChange: handleOpenChange,
    renderTriggerValue,
  }

  return <Dropdown {...dropdownProps} />
}
`,
  })
}

function createUnusedRenderPropMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import { useMessages } from 'next-intl'

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/dropdown.tsx': `
type DropdownProps = {
  renderTriggerValue?: () => React.ReactNode
}

export function Dropdown({ renderTriggerValue }: DropdownProps) {
  return <div data-render={typeof renderTriggerValue} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { Dropdown } from '@/app/workspace/[workspaceId]/monitor/dropdown'

export function MonitorPage() {
  const { copy } = useMonitorCopy()

  return <Dropdown renderTriggerValue={() => <span>{copy.orphan}</span>} />
}
`,
  })
}

function createUnusedImportedRenderPropMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']
`,
    'app/workspace/[workspaceId]/monitor/renderers.tsx': `
import type { MonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function renderTriggerValue(copy: MonitorCopy) {
  return <span>{copy.orphan}</span>
}
`,
    'app/workspace/[workspaceId]/monitor/dropdown.tsx': `
type DropdownProps = {
  renderTriggerValue?: () => React.ReactNode
}

export function Dropdown({ renderTriggerValue }: DropdownProps) {
  return <div data-render={typeof renderTriggerValue} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { Dropdown } from '@/app/workspace/[workspaceId]/monitor/dropdown'
import { renderTriggerValue } from '@/app/workspace/[workspaceId]/monitor/renderers'

export function MonitorPage() {
  const dropdownProps = { renderTriggerValue }

  return <Dropdown {...dropdownProps} />
}
`,
  })
}

function createCopyPassThroughMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/error-callout.tsx': `
type MonitorErrorCopy = {
  createDefaultView: string
  invalidViewResponse: string
  loadViews: string
}

export function ErrorCallout({ copy }: { copy: MonitorErrorCopy }) {
  return (
    <div>
      <span>{copy.loadViews}</span>
      <span>{copy.createDefaultView}</span>
      <span>{copy.invalidViewResponse}</span>
    </div>
  )
}
`,
    'app/workspace/[workspaceId]/monitor/view-bootstrap.tsx': `
import { ErrorCallout } from '@/app/workspace/[workspaceId]/monitor/error-callout'

type MonitorErrorCopy = {
  createDefaultView: string
  invalidViewResponse: string
  loadViews: string
}

export function MonitorErrorBootstrap({ copy }: { copy: MonitorErrorCopy }) {
  return <ErrorCallout copy={copy} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { MonitorErrorBootstrap } from '@/app/workspace/[workspaceId]/monitor/view-bootstrap'

export function MonitorPage() {
  const { copy } = useMonitorCopy()

  return <MonitorErrorBootstrap copy={copy.errors} />
}
`,
  })
}

function createUseCallbackMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/view-bootstrap.ts': `
type MonitorErrorCopy = {
  createDefaultView: string
  invalidViewResponse: string
  loadViews: string
}

export function bootstrapMonitorViews(copy: MonitorErrorCopy) {
  return [copy.loadViews, copy.createDefaultView, copy.invalidViewResponse].join(' ')
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useCallback, useEffect } from 'react'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { bootstrapMonitorViews } from '@/app/workspace/[workspaceId]/monitor/view-bootstrap'

export function MonitorPage() {
  const { copy } = useMonitorCopy()
  const reloadViewState = useCallback(async () => bootstrapMonitorViews(copy.errors), [copy])

  useEffect(() => {
    void reloadViewState()
  }, [reloadViewState])

  return <div>{copy.used}</div>
}
`,
  })
}

function createUnusedUseCallbackMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import type { Messages } from 'next-intl'
import { useMessages } from 'next-intl'

export type MonitorCopy = Messages['workspace']['monitor']

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useCallback } from 'react'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  const { copy } = useMonitorCopy()
  const unusedHandler = useCallback(() => copy.orphan, [copy])

  return <div data-unused={typeof unusedHandler}>{copy.used}</div>
}
`,
  })
}

function createReturnTypeMonitorProject() {
  const messages = parseLocaleMessages()
  messages.workspace.monitor.configSearch = {
    activeMonitors: 'Active monitors',
    pausedMonitors: 'Paused monitors',
    lastOutcome: 'Last outcome',
    hasLastExecution: 'Has last execution',
    noLastExecution: 'No last execution',
    hasLastOutcome: 'Has last outcome',
    noLastOutcome: 'No last outcome',
    hasLastExecutionLog: 'Has last execution log',
    noLastExecutionLog: 'No last execution log',
  }

  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/copy.ts': `
import { useMessages } from 'next-intl'

export function useMonitorCopy() {
  return {
    copy: useMessages().workspace.monitor,
  }
}
`,
    'app/workspace/[workspaceId]/monitor/config-search.ts': `
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function buildConfigSearchSuggestionSet(copy: ReturnType<typeof useMonitorCopy>['copy']) {
  return [
    copy.configSearch.activeMonitors,
    copy.configSearch.pausedMonitors,
    copy.configSearch.lastOutcome,
    copy.configSearch.hasLastExecution,
    copy.configSearch.noLastExecution,
    copy.configSearch.hasLastOutcome,
    copy.configSearch.noLastOutcome,
    copy.configSearch.hasLastExecutionLog,
    copy.configSearch.noLastExecutionLog,
  ].join(' ')
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMemo } from 'react'
import { buildConfigSearchSuggestionSet } from '@/app/workspace/[workspaceId]/monitor/config-search'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'

export function MonitorPage() {
  const { copy } = useMonitorCopy()
  const suggestions = useMemo(() => buildConfigSearchSuggestionSet(copy), [copy])

  return <div>{suggestions}</div>
}
`,
  })
}

function createNotFoundAllModeProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/not-found.tsx': `
import NotFoundContent from '@/app/not-found-content'

export default function NotFound() {
  return <NotFoundContent />
}
`,
    'app/not-found-content.tsx': `
'use client'

import { useMessages } from 'next-intl'

export default function NotFoundContent() {
  const copy = useMessages().notFound

  return (
    <section>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <button>{copy.returnHome}</button>
      <span>{copy.supportPrefix}</span>
      <a>{copy.supportLinkLabel}</a>
    </section>
  )
}
`,
  })
}

function createLoadingAllModeProject() {
  const messages = parseLocaleMessages()
  messages.workspace.loading = {
    title: 'Loading title',
    description: 'Loading description',
    orphan: 'Loading orphan',
  }

  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/page.tsx':
      'export default function Page(){ return <div /> }\n',
    'app/workspace/[workspaceId]/loading.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function Loading() {
  const t = useTranslations('workspace.loading')

  return (
    <section>
      <span>{t('title')}</span>
      <span>{t('description')}</span>
    </section>
  )
}
`,
  })
}

function createConcreteRouteResolutionProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/(landing)/blog/page.tsx':
      'export default function BlogIndexPage() { return <div /> }\n',
    'app/[locale]/(landing)/blog/[slug]/page.tsx':
      'export default function BlogSlugPage() { return <div /> }\n',
    'app/[locale]/(auth)/error/[[...callback]]/page.tsx':
      'export default function ErrorPage() { return <div /> }\n',
    'app/[locale]/[...notFound]/page.tsx':
      'export default function NotFoundPage() { return <div /> }\n',
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      'export default function MonitorPage() { return <div /> }\n',
  })
}

function createRouteBoundaryProject() {
  const enMessages = parseLocaleMessages()
  const esMessages = parseLocaleMessages()
  const zhMessages = parseLocaleMessages()

  for (const localeMessages of [enMessages, esMessages, zhMessages]) {
    localeMessages.workspace.monitor.boundary = {
      errorTitle: 'Route error',
      globalErrorTitle: 'Route global error',
    }
  }

  return createTempProject({
    'i18n/messages/en.json': toJson(enMessages),
    'i18n/messages/es.json': toJson(esMessages),
    'i18n/messages/zh.json': toJson(zhMessages),
    'app/[locale]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      'export default function MonitorPage() { return <div /> }\n',
    'app/[locale]/not-found.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function NotFound() {
  const t = useTranslations('notFound')

  return (
    <section>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </section>
  )
}
`,
    'app/workspace/[workspaceId]/error.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function WorkspaceError() {
  const t = useTranslations('workspace.monitor.boundary')
  return <div>{t('errorTitle')}</div>
}
`,
    'app/workspace/[workspaceId]/monitor/global-error.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function MonitorGlobalError() {
  const t = useTranslations('workspace.monitor.boundary')
  return <div>{t('globalErrorTitle')}</div>
}
`,
  })
}

function createAllModeOwnershipProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
import { MonitorRoutePanel } from '@/app/workspace/[workspaceId]/monitor/monitor-route-panel'
import { SharedLabel } from '@/components/shared-label'

export function MonitorPage() {
  return (
    <section>
      <MonitorRoutePanel />
      <SharedLabel />
    </section>
  )
}
`,
    'app/workspace/[workspaceId]/monitor/monitor-route-panel.tsx': `
export function MonitorRoutePanel() {
  return <button title="Run now" />
}
`,
    'components/shared-label.tsx': `
export function SharedLabel() {
  return <span>Shared label</span>
}
`,
  })
}

function createSharedAdminRouteProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/admin/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/admin/integrations/page.tsx':
      "import { IntegrationsAdmin } from '@/app/admin/integrations/integrations-admin'\nexport default function Page(){ return <IntegrationsAdmin /> }\n",
    'app/[locale]/admin/services/page.tsx':
      "import { ServicesAdmin } from '@/app/admin/services/services-admin'\nexport default function Page(){ return <ServicesAdmin /> }\n",
    'app/admin/admin-inline-secret-field.tsx': `
export function AdminInlineSecretField() {
  return (
    <div>
      <button>Save</button>
      <button>Edit</button>
    </div>
  )
}
`,
    'app/admin/integrations/integrations-admin.tsx': `
import { AdminInlineSecretField } from '@/app/admin/admin-inline-secret-field'

export function IntegrationsAdmin() {
  return <AdminInlineSecretField />
}
`,
    'app/admin/services/services-admin.tsx': `
import { AdminInlineSecretField } from '@/app/admin/admin-inline-secret-field'

export function ServicesAdmin() {
  return <AdminInlineSecretField />
}
`,
  })
}

function createAllModeAliasNamespaceProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/admin/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/admin/billing/page.tsx':
      "import { BillingNotice } from '@/app/admin/billing/billing-notice'\nexport default function Page(){ return <BillingNotice /> }\n",
    'app/[locale]/admin/billing/[tierId]/page.tsx':
      "import { BillingNotice } from '@/app/admin/billing/billing-notice'\nexport default function Page(){ return <BillingNotice /> }\n",
    'app/admin/billing/billing-notice.tsx': `
export function BillingNotice() {
  return <button title="Refresh catalog" />
}
`,
  })
}

function createAppRootGlobalBoundaryProject() {
  const enMessages = parseLocaleMessages()
  const esMessages = parseLocaleMessages()
  const zhMessages = parseLocaleMessages()

  for (const localeMessages of [enMessages, esMessages, zhMessages]) {
    localeMessages.workspace.monitor.boundary = {
      rootGlobalErrorTitle: 'Root global error',
    }
  }

  return createTempProject({
    'i18n/messages/en.json': toJson(enMessages),
    'i18n/messages/es.json': toJson(esMessages),
    'i18n/messages/zh.json': toJson(zhMessages),
    'app/[locale]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/global-error.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export default function GlobalError() {
  const t = useTranslations('workspace.monitor.boundary')
  return <div>{t('rootGlobalErrorTitle')}</div>
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
import { SharedLabel } from '@/components/shared-label'

export function MonitorPage() {
  return <SharedLabel />
}
`,
    'components/shared-label.tsx': `
export function SharedLabel() {
  return <span>Shared label</span>
}
`,
  })
}

function createDynamicLocaleGapProject() {
  const enMessages = parseLocaleMessages()
  const esMessages = parseLocaleMessages()
  const zhMessages = parseLocaleMessages()

  delete esMessages.workspace.monitor.values.paused
  delete zhMessages.workspace.monitor.values.paused

  return createTempProject({
    'i18n/messages/en.json': toJson(enMessages),
    'i18n/messages/es.json': toJson(esMessages),
    'i18n/messages/zh.json': toJson(zhMessages),
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor
  const status = 'paused'

  return <div>{copy.values[status]}</div>
}
`,
  })
}

function createLandingArrayProject() {
  const enMessages = parseLocaleMessages()
  const esMessages = parseLocaleMessages()
  const zhMessages = parseLocaleMessages()

  for (const localeMessages of [enMessages, esMessages, zhMessages]) {
    localeMessages.landing = {
      hero: {
        leadWords: ['Build', 'Test'],
        highlightWords: ['Trading Analysis', 'Signal Detection'],
        featureBadges: ['A', 'B', 'C'],
      },
      features: {
        rows: [
          {
            title: 'One',
            bullets: ['B1', 'B2'],
          },
        ],
      },
      howItWorks: {
        processes: [
          {
            title: 'Collect',
            description: 'Collect inputs',
          },
        ],
      },
    }
  }

  esMessages.landing.hero.leadWords = ['Build', null]
  esMessages.landing.hero.featureBadges = ['A', null, 'C']

  return createTempProject({
    'i18n/messages/en.json': toJson(enMessages),
    'i18n/messages/es.json': toJson(esMessages),
    'i18n/messages/zh.json': toJson(zhMessages),
    'app/[locale]/page.tsx':
      "import { LandingPage } from '@/app/landing/landing-page'\nexport default function Page(){ return <LandingPage /> }\n",
    'app/landing/landing-page.tsx': `
'use client'

import { useMessages } from 'next-intl'

export function LandingPage() {
  const copy = useMessages()
  const words = copy.landing.hero.leadWords

  return (
    <section>
      <span>{copy.landing.hero.featureBadges[0]}</span>
      <div>{words.join(' ')}</div>
      <div>{copy.landing.features.rows.map((row) => row.title).join(' ')}</div>
      <div>{copy.landing.howItWorks.processes.map((process) => process.title).join(' ')}</div>
    </section>
  )
}
      `,
  })
}

function createArrayBuiltinProject() {
  const messages = parseLocaleMessages()
  messages.workspace.monitor.nextSteps = ['One', 'Two']

  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/details-list.tsx': `
type DetailsListProps = {
  details: string[]
}

export function DetailsList({ details }: DetailsListProps) {
  return details.length > 0 ? (
    <section>
      {details.map((detail) => (
        <span key={detail}>{detail}</span>
      ))}
    </section>
  ) : null
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { DetailsList } from '@/app/workspace/[workspaceId]/monitor/details-list'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor

  return <DetailsList details={copy.nextSteps} />
}
`,
  })
}

function createInlineFormatterProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useTranslations } from 'next-intl'
import { formatTemplate } from '@/i18n/utils'

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')

  return <div>{t('used')} {formatTemplate('Hello {name}', { name: 'Ada' })}</div>
}
`,
    'i18n/utils.ts': `
import { createTranslator } from 'next-intl'

export function formatTemplate(template: string, values: Record<string, string>) {
  let formatError: unknown
  const translator = createTranslator({
    locale: 'en',
    messages: { value: template },
    onError(error) {
      formatError = error
    },
  })
  const formatted = translator('value', values)

  if (formatError) {
    throw formatError
  }

  return formatted
}
`,
  })
}

function createUnusedHelperMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages, useTranslations } from 'next-intl'

function UnusedMonitorCopy() {
  const copy = useMessages().workspace.monitor

  return <div>{copy.orphan}</div>
}

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')

  return <div>{t('used')}</div>
}
`,
  })
}

function createUnusedExportedHelperMonitorProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useTranslations } from 'next-intl'

export function MonitorPage() {
  const t = useTranslations('workspace.monitor')

  return <div>{t('used')}</div>
}
`,
    'app/workspace/[workspaceId]/monitor/unused-helper.tsx': `
'use client'

import { useMessages } from 'next-intl'

export function UnusedExportedHelper() {
  const copy = useMessages().workspace.monitor

  return <div>{copy.orphan}</div>
}
`,
  })
}

function buildRouteReport(
  projectRoot: string,
  routePath: string,
  options?: { withOrphans?: boolean }
) {
  const scanResult = scanCatalogProject({
    mode: 'route',
    projectRoot,
    routePath,
  })
  const globalScanResult = options?.withOrphans
    ? scanCatalogProject({ mode: 'all', projectRoot })
    : undefined

  return {
    scanResult,
    globalScanResult,
    report: buildCatalogReport({
      projectRoot,
      scanResult,
      globalScanResult,
    }),
  }
}

function buildAllReport(projectRoot: string) {
  const scanResult = scanCatalogProject({ mode: 'all', projectRoot })

  return {
    scanResult,
    report: buildCatalogReport({
      projectRoot,
      scanResult,
      globalScanResult: scanResult,
    }),
  }
}

function getCoveragePathKeys(
  scanResult: CatalogScanResult,
  options?: {
    mode?: CoverageRecord['mode']
    subtreeReason?: CoverageRecord['subtreeReason']
  }
) {
  return [
    ...new Set(
      scanResult.coverage
        .filter((coverage) => (options?.mode ? coverage.mode === options.mode : true))
        .filter((coverage) =>
          options?.subtreeReason ? coverage.subtreeReason === options.subtreeReason : true
        )
        .map((coverage) => coverage.pathKey)
    ),
  ]
}

function snapshotFiles(projectRoot: string, relativePaths: string[]) {
  return Object.fromEntries(
    relativePaths.map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'),
    ])
  )
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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

describe('i18n catalog scanner', () => {
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

  it('captures copy access through optional-chain monitor error copy', () => {
    const projectRoot = createOptionalChainMonitorProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
  })

  it('captures copy access through promise callbacks in verify flows', () => {
    const projectRoot = createVerifyPromiseProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/verify',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'auth.verify.pendingTitle',
        'auth.verify.errors.expired',
        'auth.verify.errors.invalid',
        'auth.verify.errors.attempts',
        'auth.verify.errors.generic',
        'auth.verify.errors.resendFailed',
      ])
    )
  })

  it('captures copy access through timer and microtask callbacks', () => {
    const projectRoot = createTimerCallbackMonitorProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.used',
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
  })

  it('captures copy access through startTransition callbacks', () => {
    const projectRoot = createStartTransitionMonitorProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.used',
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
      ])
    )
  })

  it('captures copy access through invoked render props and callback props', () => {
    const projectRoot = createRenderPropMonitorProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/workspace/[workspaceId]/monitor',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.timezone.label',
        'workspace.monitor.timezone.loading',
        'workspace.monitor.timezone.empty',
        'workspace.monitor.timezone.placeholder',
      ])
    )
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

  it('ignores punctuation-only hardcoded candidates', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx': `
export default function Page() {
  return (
    <div>
      :
      %
      |
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

    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: ':' }),
        expect.objectContaining({ text: '%' }),
        expect.objectContaining({ text: '|' }),
      ])
    )
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

describe('i18n catalog report derivation', () => {
  it('canonicalizes concrete CLI route inputs in scan and report output', () => {
    const projectRoot = createBaseProject()

    const cliResult = runCatalogCli(projectRoot, {
      route: '/workspace/ws-1/monitor',
    })

    expect(cliResult.scan.routePath).toBe('/workspace/[workspaceId]/monitor')
    expect(cliResult.report.routePath).toBe('/workspace/[workspaceId]/monitor')
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

  it('rejects `--all --with-orphans`', () => {
    const projectRoot = createBaseProject()

    expect(() =>
      runCatalogCli(projectRoot, {
        all: true,
        withOrphans: true,
      })
    ).toThrow('`--with-orphans` is only valid with `--route <pathname>`')
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

    const { scanResult, report } = buildAllReport(projectRoot)

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
    const expectedTargetLocales = locales
      .filter((locale) => locale !== defaultLocale)
      .sort()

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

    const { scanResult, report } = buildAllReport(projectRoot)

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

    const { scanResult, report } = buildAllReport(projectRoot)

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
    expect(getRouteOwnedNamespaces('/error')).toEqual([
      'auth.common',
      'auth.error',
      'auth.sso',
    ])
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
