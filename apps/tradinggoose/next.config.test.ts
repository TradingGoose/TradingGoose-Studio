import { describe, expect, it } from 'vitest'
import { getMainCSPPolicy, readWorkflowExecutionCSPPolicy } from './lib/security/csp'
import nextConfig from './next.config'

type HeaderRules = Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>

async function getHeaderRules(): Promise<HeaderRules> {
  const rules = await nextConfig.headers?.()

  if (!rules) {
    throw new Error('Expected next.config.ts to define headers()')
  }

  return rules
}

function buildSourceMatcher(source: string) {
  if (source.includes('/((?!') || source === '/(.*)\\.map$') {
    const matcher = new RegExp(`^${source}$`)
    return (path: string) => matcher.test(path)
  }

  switch (source) {
    case '/api/:path((?!workflows/[^/]+/execute$).*)':
      return (path: string) => /^\/api\/.+$/.test(path) && !/^\/api\/workflows\/[^/]+\/execute$/.test(path)
    case '/api/workflows/:id/execute':
      return (path: string) => /^\/api\/workflows\/[^/]+\/execute$/.test(path)
    case '/:app(w|workspace|chat)/:path*':
      return (path: string) => /^\/(?:w|workspace|chat)(?:\/.*)?$/.test(path)
    case '/:locale(es|zh)/:app(w|workspace|chat)/:path*':
      return (path: string) => /^\/(?:es|zh)\/(?:w|workspace|chat)(?:\/.*)?$/.test(path)
    case '/api/tools/drive/:path*':
      return (path: string) => /^\/api\/tools\/drive(?:\/.*)?$/.test(path)
    case '/_next/:path*':
      return (path: string) => /^\/_next(?:\/.*)?$/.test(path)
    case '/_vercel/:path*':
      return (path: string) => /^\/_vercel(?:\/.*)?$/.test(path)
    default:
      throw new Error(`Unhandled header source pattern: ${source}`)
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
      '/_next/static/chunks/main.js',
      '/_vercel/insights/view',
    ]
    const apiPaths = ['/api/workspaces/invitations/invitation-1']

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
    const infrastructurePaths = ['/ingest/e']

    for (const path of publicPaths) {
      expectHeaderValue(rules, path, 'Cross-Origin-Embedder-Policy', 'credentialless')
      expectHeaderValue(rules, path, 'Cross-Origin-Opener-Policy', 'same-origin')
      expectHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
      expectNoHeaderValue(rules, path, 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    }

    for (const path of infrastructurePaths) {
      expectNoHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
      expectNoHeaderValue(rules, path, 'Cross-Origin-Embedder-Policy', 'credentialless')
    }
  })

  it('keeps workflow execution routes on the specialized execution header policy only', async () => {
    const rules = await getHeaderRules()
    const executionPaths = ['/api/workflows/test/execute']

    for (const path of executionPaths) {
      expect(getHeaderValues(rules, path, 'Access-Control-Allow-Origin')).toEqual(['*'])
      expect(getHeaderValues(rules, path, 'Access-Control-Allow-Credentials')).toEqual([])
      expect(getHeaderValues(rules, path, 'Cross-Origin-Embedder-Policy')).toEqual(['unsafe-none'])
      expectHeaderValue(rules, path, 'Content-Security-Policy', readWorkflowExecutionCSPPolicy())
      expectNoHeaderValue(rules, path, 'Content-Security-Policy', getMainCSPPolicy())
    }
  })
})
