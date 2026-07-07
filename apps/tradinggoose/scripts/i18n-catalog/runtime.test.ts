import { afterEach, describe, expect, it } from 'vitest'
import { scanCatalogProject } from './scan'
import {
  cleanupTempProjects,
  createLocaleMessages,
  createOptionalChainMonitorProject,
  createRenderPropMonitorProject,
  createStartTransitionMonitorProject,
  createTempProject,
  createTimerCallbackMonitorProject,
  createVerifyPromiseProject,
  getCoveragePathKeys,
} from './test-utils'

afterEach(cleanupTempProjects)

describe('i18n catalog scanner runtime', () => {
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
})
