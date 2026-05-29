import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { isDev, isHosted } from '@/lib/environment'
import { env, isTruthy } from './lib/env'
import { getMainCSPPolicy, readWorkflowExecutionCSPPolicy } from './lib/security/csp'

const MONACO_TRACE_ROOTS = ['./node_modules', './apps/tradinggoose/node_modules'] as const
const MONACO_TRACE_FILES = MONACO_TRACE_ROOTS.flatMap((root) => [
  `${root}/monaco-editor/esm/vs/**/*.js`,
  `${root}/monaco-editor/esm/vs/**/*.js.map`,
  `${root}/.bun/monaco-editor@*/node_modules/monaco-editor/esm/vs/**/*.js`,
  `${root}/.bun/monaco-editor@*/node_modules/monaco-editor/esm/vs/**/*.js.map`,
])
const PUBLIC_LOCALE_ROUTE_PREFIX = '(?:es|zh)'
const LOCALIZED_API_ROUTE_SOURCE = `(?:api|${PUBLIC_LOCALE_ROUTE_PREFIX}/api)(?:/.*)?`
const LOCALIZED_API_ROUTE_LOOKAHEAD = `${LOCALIZED_API_ROUTE_SOURCE}$`
const LOCALIZED_APP_ROUTE_SOURCE =
  `(?:${PUBLIC_LOCALE_ROUTE_PREFIX}/)?(?:w|workspace|chat)(?:/.*)?`
const LOCALIZED_APP_ROUTE_LOOKAHEAD = `${LOCALIZED_APP_ROUTE_SOURCE}$`
const API_ROUTE_PARAM_EXCLUDING_WORKFLOW_EXECUTION =
  ':path((?!workflows/[^/]+/execute$).*)'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      // GitHub raw content (blog images)
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'github.com',
      },
      {
        protocol: 'https',
        hostname: 'api.stability.ai',
      },
      {
        protocol: 'https',
        hostname: 'cdn.*.com',
      },
      // Azure storage
      {
        protocol: 'https',
        hostname: '*.blob.core.windows.net',
      },
      // Vercel Blob
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
      {
        protocol: 'https',
        hostname: '*.private.blob.vercel-storage.com',
      },
      // AWS S3
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
    qualities: [75, 100],
  },
  typescript: {
    ignoreBuildErrors: isTruthy(env.DOCKER_BUILD) || isTruthy(env.VERCEL),
  },
  output: isTruthy(env.DOCKER_BUILD) ? 'standalone' : undefined,
  outputFileTracingIncludes: {
    '/monaco-editor/esm/vs/**/*': MONACO_TRACE_FILES,
  },
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  serverExternalPackages: [
    'playwright-core',
    'playwright',
    '@browserbasehq/stagehand',
    'postgres',
    'yjs',
  ],
  experimental: {
    optimizeCss: true,
    turbopackSourceMaps: false,
    turbopackFileSystemCacheForDev: true,
    preloadEntriesOnStart: true,
    optimizePackageImports: [
      'lucide-react',
      'lodash',
      'framer-motion',
      '@xyflow/react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-switch',
      '@radix-ui/react-slider',
      'react-markdown',
      'zod',
      'date-fns',
    ],
  },
  ...(isDev && {
    allowedDevOrigins: [
      ...(env.NEXT_PUBLIC_APP_URL
        ? (() => {
            try {
              return [new URL(env.NEXT_PUBLIC_APP_URL).host]
            } catch {
              return []
            }
          })()
        : []),
      'localhost:3000',
      'localhost:3001',
    ],
  }),
  transpilePackages: [
    'prettier',
    '@react-email/components',
    '@react-email/render',
    '@t3-oss/env-nextjs',
    '@t3-oss/env-core',
    '@tradinggoose/db',
  ],
  async headers() {
    const apiRouteHeaders = [
      { key: 'Access-Control-Allow-Credentials', value: 'true' },
      {
        key: 'Access-Control-Allow-Origin',
        value: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001',
      },
      {
        key: 'Access-Control-Allow-Methods',
        value: 'GET,POST,OPTIONS,PUT,DELETE',
      },
      {
        key: 'Access-Control-Allow-Headers',
        value:
          'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key',
      },
    ]
    const permissiveRouteHeaders = [
      {
        key: 'Cross-Origin-Embedder-Policy',
        value: 'unsafe-none',
      },
      {
        key: 'Cross-Origin-Opener-Policy',
        value: 'same-origin-allow-popups',
      },
    ]
    const workflowExecutionHeaders = [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      {
        key: 'Access-Control-Allow-Methods',
        value: 'GET,POST,OPTIONS,PUT',
      },
      {
        key: 'Access-Control-Allow-Headers',
        value:
          'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key',
      },
      { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
      { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
      {
        key: 'Content-Security-Policy',
        value: readWorkflowExecutionCSPPolicy(),
      },
    ]

    return [
      {
        // API routes CORS headers, excluding workflow execution which has a dedicated policy
        source: `/api/${API_ROUTE_PARAM_EXCLUDING_WORKFLOW_EXECUTION}`,
        headers: apiRouteHeaders,
      },
      {
        // Locale-prefixed API routes use the same CORS headers as the canonical API path,
        // excluding workflow execution which has a dedicated policy
        source: `/:locale(es|zh)/api/${API_ROUTE_PARAM_EXCLUDING_WORKFLOW_EXECUTION}`,
        headers: apiRouteHeaders,
      },
      // For workflow execution API endpoints
      {
        source: '/api/workflows/:id/execute',
        headers: workflowExecutionHeaders,
      },
      {
        source: '/:locale(es|zh)/api/workflows/:id/execute',
        headers: workflowExecutionHeaders,
      },
      {
        // Exclude Vercel internal resources and static assets from strict COEP, Google Drive Picker to prevent 'refused to connect' issue
        source: `/((?!_next|_vercel|favicon.ico|${LOCALIZED_API_ROUTE_LOOKAHEAD}|${LOCALIZED_APP_ROUTE_LOOKAHEAD}).*)`,
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      {
        // For main app routes - use permissive policies
        source: '/:app(w|workspace|chat)/:path*',
        headers: permissiveRouteHeaders,
      },
      {
        // Localized public app routes use the same permissive policies
        source: '/:locale(es|zh)/:app(w|workspace|chat)/:path*',
        headers: permissiveRouteHeaders,
      },
      {
        // Google Drive Picker uses permissive cross-origin policies
        source: '/api/tools/drive/:path*',
        headers: permissiveRouteHeaders,
      },
      {
        source: '/:locale(es|zh)/api/tools/drive/:path*',
        headers: permissiveRouteHeaders,
      },
      {
        // Vercel static resources use permissive cross-origin policies
        source: '/_next/:path*',
        headers: permissiveRouteHeaders,
      },
      {
        source: '/_vercel/:path*',
        headers: permissiveRouteHeaders,
      },
      // Block access to sourcemap files (defense in depth)
      {
        source: '/(.*)\\.map$',
        headers: [
          {
            key: 'x-robots-tag',
            value: 'noindex',
          },
        ],
      },
      // Apply security headers to routes not handled by middleware runtime CSP
      // Middleware handles: /, /workspace/*, /chat/*
      {
        source: `/((?!${LOCALIZED_API_ROUTE_LOOKAHEAD}|${LOCALIZED_APP_ROUTE_LOOKAHEAD}).*)`,
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: getMainCSPPolicy(),
          },
        ],
      },
    ]
  },
  async redirects() {
    const redirects = []

    // Redirect /building to /blog (legacy URL support)
    redirects.push({
      source: '/building/:path*',
      destination: '/blog/:path*',
      permanent: true,
    })

    // Only enable domain redirects for the hosted version
    if (isHosted) {
      redirects.push({
        source: '/((?!api|_next|_vercel|favicon|static|ingest|.*\\..*).*)',
        destination: 'https://www.tradinggoose.ai/$1',
        permanent: true,
        has: [{ type: 'host' as const, value: 'tradinggoose.ai' }],
      })
    }

    return redirects
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]
  },
}

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

export default withNextIntl(nextConfig)
