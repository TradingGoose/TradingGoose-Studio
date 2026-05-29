import { match } from 'path-to-regexp'
import { describe, expect, it } from 'vitest'
import { getMainCSPPolicy, readWorkflowExecutionCSPPolicy } from './lib/security/csp'
import nextConfig from './next.config'

type HeaderRules = Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>
type RouteParams = Record<string, string | string[] | undefined>

const PUBLIC_LOCALES = new Set(['es', 'zh'])
const PUBLIC_APP_ROUTES = new Set(['w', 'workspace', 'chat'])
const WORKFLOW_EXECUTION_PATH = /^workflows\/[^/]+\/execute$/

async function getHeaderRules(): Promise<HeaderRules> {
  const rules = await nextConfig.headers?.()

  if (!rules) {
    throw new Error('Expected next.config.ts to define headers()')
  }

  return rules
}

function getSplatPath(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join('/') : value ?? ''
}

function buildSourceMatcher(source: string) {
  if (source.includes('/((?!') || source === '/(.*)\\.map$') {
    const matcher = new RegExp(`^${source}$`)
    return (path: string) => matcher.test(path)
  }

  const normalizedSource = source
    .replace('/:path((?!workflows/[^/]+/execute$).*)', '{/*path}')
    .replace(':locale(es|zh)', ':locale')
    .replace(':app(w|workspace|chat)', ':app')
    .replace(/\/:path\*/g, '{/*path}')
  const matcher = match<RouteParams>(normalizedSource)

  return (path: string) => {
    const result = matcher(path)
    if (!result) {
      return false
    }

    if (source.includes(':locale(es|zh)') && !PUBLIC_LOCALES.has(String(result.params.locale))) {
      return false
    }

    if (source.includes(':app(w|workspace|chat)') && !PUBLIC_APP_ROUTES.has(String(result.params.app))) {
      return false
    }

    if (
      source.includes(':path((?!workflows/[^/]+/execute$).*)') &&
      WORKFLOW_EXECUTION_PATH.test(getSplatPath(result.params.path))
    ) {
      return false
    }

    return true
  }
}

function matchesSource(source: string, path: string) {
  return buildSourceMatcher(source)(path)
}

function getHeaderValues(rules: HeaderRules, path: string, key: string) {
  return rules
    .filter((rule) => matchesSource(rule.source, path))
    .flatMap((rule) => rule.headers.filter((header) => header.key === key).map((header) => header.value))
}

function expectHeaderValue(rules: HeaderRules, path: string, key: string, value: string) {
  expect(getHeaderValues(rules, path, key)).toContain(value)
}

function expectNoHeaderValue(rules: HeaderRules, path: string, key: string, value: string) {
  expect(getHeaderValues(rules, path, key)).not.toContain(value)
}

describe('next.config headers routing', () => {
  it('parses every header source with the Next route matcher', async () => {
    const rules = await getHeaderRules()

    for (const rule of rules) {
      expect(() => buildSourceMatcher(rule.source)).not.toThrow()
    }
  })

  it('applies permissive app headers to localized, unlocalized, and internal app resources', async () => {
    const rules = await getHeaderRules()
    const appPaths = [
      '/workspace/ws-1/dashboard',
      '/chat/test-chat',
      '/es/workspace/ws-1/dashboard',
      '/zh/chat/test-chat',
    ]
    const permissiveInternalResourcePaths = [
      '/api/tools/drive/files',
      '/zh/api/tools/drive/files',
      '/_next/static/chunks/main.js',
      '/_vercel/insights/view',
    ]
    const apiPaths = ['/es/api/workspaces/invitations/invitation-1']

    for (const path of [...appPaths, ...permissiveInternalResourcePaths]) {
      expectHeaderValue(rules, path, 'Cross-Origin-Embedder-Policy', 'unsafe-none')
      expectHeaderValue(rules, path, 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    }

    for (const path of [...appPaths, ...apiPaths]) {
      expectNoHeaderValue(rules, path, 'Cross-Origin-Embedder-Policy', 'credentialless')
      expectNoHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
    }

    for (const path of apiPaths) {
      expectHeaderValue(rules, path, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE')
    }
  })

  it('keeps strict cross-origin and public-page CSP headers on representative public routes', async () => {
    const rules = await getHeaderRules()
    const publicPaths = ['/', '/privacy', '/es/privacy', '/blog/hello-world']

    for (const path of publicPaths) {
      expectHeaderValue(rules, path, 'Cross-Origin-Embedder-Policy', 'credentialless')
      expectHeaderValue(rules, path, 'Cross-Origin-Opener-Policy', 'same-origin')
      expectHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
      expectNoHeaderValue(rules, path, 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    }
  })

  it('keeps workflow execution routes on the specialized execution header policy only', async () => {
    const rules = await getHeaderRules()
    const executionPaths = [
      '/api/workflows/test/execute',
      '/es/api/workflows/test/execute',
      '/zh/api/workflows/test/execute',
    ]

    for (const path of executionPaths) {
      expect(getHeaderValues(rules, path, 'Access-Control-Allow-Origin')).toEqual(['*'])
      expect(getHeaderValues(rules, path, 'Access-Control-Allow-Credentials')).toEqual([])
      expect(getHeaderValues(rules, path, 'Cross-Origin-Embedder-Policy')).toEqual(['unsafe-none'])
      expectHeaderValue(rules, path, 'Content-Security-Policy', readWorkflowExecutionCSPPolicy())
      expectNoHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
    }
  })
})
