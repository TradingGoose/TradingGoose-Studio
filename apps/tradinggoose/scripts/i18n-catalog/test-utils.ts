import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildCatalogReport } from './catalog'
import { type CatalogScanResult, type CoverageRecord, scanCatalogProject } from './scan'

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
        widgets: {
          titles: {
            quick_order: 'Quick Order',
          },
          selector: {
            selectWidget: 'Select widget',
            widgetSelectionUnavailable: 'Widget selection unavailable',
            categories: {
              trading: 'Trading',
              list: 'Lists',
              editor: 'Editor',
              utility: 'Utils',
            },
          },
          quickOrder: {
            body: {
              submitOrder: 'Submit order',
            },
            header: {
              title: 'Quick Order',
              buy: 'Buy',
              sell: 'Sell',
            },
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

function createWrappedExportMonitorProject(wrapper: 'forwardRef' | 'memo' | 'memoForwardRef') {
  const messages = createLocaleMessages()
  const reactImport =
    wrapper === 'forwardRef'
      ? "import { forwardRef } from 'react'"
      : wrapper === 'memo'
        ? "import { memo } from 'react'"
        : "import { forwardRef, memo } from 'react'"
  const componentDefinition =
    wrapper === 'memo'
      ? `
function MonitorCardComponent() {
  const copy = useMessages().workspace.monitor

  return <div>{copy.used}</div>
}
`
      : `
function MonitorCardComponent(_props: object, _ref: any) {
  const copy = useMessages().workspace.monitor

  return <div>{copy.used}</div>
}
`
  const exportLine =
    wrapper === 'forwardRef'
      ? 'export const MonitorCard = forwardRef(MonitorCardComponent)'
      : wrapper === 'memo'
        ? 'export const MonitorCard = memo(MonitorCardComponent)'
        : 'export const MonitorCard = memo(forwardRef(MonitorCardComponent))'

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorCard } from '@/app/workspace/[workspaceId]/monitor/monitor-card'\nexport default function Page(){ return <MonitorCard /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor-card.tsx': `
'use client'

${reactImport}
import { useMessages } from 'next-intl'

${componentDefinition.trim()}

${exportLine}
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

  esMessages.workspace.monitor.values = Object.fromEntries(
    Object.entries(esMessages.workspace.monitor.values).filter(([key]) => key !== 'paused')
  )
  zhMessages.workspace.monitor.values = Object.fromEntries(
    Object.entries(zhMessages.workspace.monitor.values).filter(([key]) => key !== 'paused')
  )

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

function createStringMethodMonitorProject() {
  const messages = parseLocaleMessages()
  messages.workspace.monitor.label = 'Label'
  messages.workspace.monitor.noItemsFound = 'No {itemName} found'
  messages.workspace.monitor.pages = 'Pages'

  const localeMessages = toJson(messages)

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { formatTemplate } from '@/i18n/utils'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor

  return (
    <section>
      <span>{copy.label.toLowerCase()}</span>
      <span>{formatTemplate(copy.noItemsFound, { itemName: copy.pages.toLowerCase() })}</span>
    </section>
  )
}
`,
    'i18n/utils.ts': `
export function formatTemplate(template: string, values: Record<string, string>) {
  return template.replace('{itemName}', values.itemName)
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

function createAllModeEmailProject() {
  const localeMessages = toJson({
    emails: {
      body: 'Welcome body',
      orphan: 'Unused email copy',
      subject: 'Welcome subject',
    },
  })

  return createTempProject({
    'i18n/messages/en.json': localeMessages,
    'i18n/messages/es.json': localeMessages,
    'i18n/messages/zh.json': localeMessages,
    'app/[locale]/page.tsx': 'export default function Page() { return null }\n',
    'components/emails/email-copy.ts': `
import { getPublicCopy } from '@/i18n/public-copy'

export type EmailLocale = string | undefined

export function getEmailCopy(locale?: EmailLocale) {
  return getPublicCopy(locale).emails
}
`,
    'components/emails/render-email.ts': `
import { getEmailCopy } from '@/components/emails/email-copy'

export function getEmailSubject(locale?: string) {
  return getEmailCopy(locale).subject
}

export function renderWaitlistConfirmationEmail(locale?: string) {
  const copy = getEmailCopy(locale)
  return [getEmailSubject(locale), copy.body].join(' ')
}

export function renderOrphanPreview(locale?: string) {
  const copy = getEmailCopy(locale)
  return copy.orphan
}
`,
    'i18n/public-copy.ts': `
export function getPublicCopy(_locale?: string) {
  return {} as {
    emails: {
      body: string
      orphan: string
      subject: string
    }
  }
}
`,
  })
}

function createRuntimeMatrixProject(monitorSource: string) {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/monitor.tsx': monitorSource,
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
      includeOrphans: Boolean(options?.withOrphans),
      projectRoot,
      scanResult,
      globalScanResult,
    }),
  }
}

function buildAllReport(projectRoot: string, options?: { withOrphans?: boolean }) {
  const scanResult = scanCatalogProject({ mode: 'all', projectRoot })
  const globalScanResult = options?.withOrphans ? scanResult : undefined

  return {
    scanResult,
    globalScanResult,
    report: buildCatalogReport({
      includeOrphans: Boolean(options?.withOrphans),
      projectRoot,
      scanResult,
      globalScanResult,
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

export function cleanupTempProjects() {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export {
  writeProjectFiles,
  createTempProject,
  matchesProjectFilePath,
  createLocaleMessages,
  parseLocaleMessages,
  toJson,
  createBaseProject,
  createChangelogProject,
  createOptionalChainMonitorProject,
  createVerifyPromiseProject,
  createTimerCallbackMonitorProject,
  createStartTransitionMonitorProject,
  createRenderPropMonitorProject,
  createImportedRenderPropMonitorProject,
  createUnusedRenderPropMonitorProject,
  createUnusedImportedRenderPropMonitorProject,
  createCopyPassThroughMonitorProject,
  createUseCallbackMonitorProject,
  createUnusedUseCallbackMonitorProject,
  createWrappedExportMonitorProject,
  createReturnTypeMonitorProject,
  createNotFoundAllModeProject,
  createLoadingAllModeProject,
  createConcreteRouteResolutionProject,
  createRouteBoundaryProject,
  createAllModeOwnershipProject,
  createSharedAdminRouteProject,
  createAllModeAliasNamespaceProject,
  createAppRootGlobalBoundaryProject,
  createDynamicLocaleGapProject,
  createLandingArrayProject,
  createArrayBuiltinProject,
  createInlineFormatterProject,
  createStringMethodMonitorProject,
  createUnusedHelperMonitorProject,
  createUnusedExportedHelperMonitorProject,
  createAllModeEmailProject,
  createRuntimeMatrixProject,
  buildRouteReport,
  buildAllReport,
  getCoveragePathKeys,
  snapshotFiles,
}
