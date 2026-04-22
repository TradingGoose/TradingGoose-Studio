import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { PUBLIC_ENV_KEY } from 'next-runtime-env'
import { generateBrandedMetadata } from '@/lib/branding/metadata'
import { createLogger } from '@/lib/logs/console/logger'
import { PostHogProvider } from '@/lib/posthog/provider'
import 'monaco-editor/min/vs/editor/editor.main.css'
import '@/app/globals.css'

import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionProvider } from '@/lib/session/session-context'
import { ProviderModelsBootstrap } from '@/app/provider-models-bootstrap'
import { QueryProvider } from '@/app/query-provider'
import { ThemeProvider } from '@/app/theme-provider'
import { ZoomPrevention } from '@/app/zoom-prevention'

const logger = createLogger('RootLayout')

const BROWSER_EXTENSION_ATTRIBUTES = [
  'data-new-gr-c-s-check-loaded',
  'data-gr-ext-installed',
  'data-gr-ext-disabled',
  'data-grammarly',
  'data-fgm',
  'data-lt-installed',
  'data-sharkid',
  'data-sharklabel',
  'data-sharkidcontainer',
  'shark-icon-container',
]

if (typeof window !== 'undefined') {
  const originalError = console.error
  console.error = (...args) => {
    const messages = args.filter((arg): arg is string => typeof arg === 'string')
    const isHydrationError = messages.some((message) => message.includes('Hydration'))

    if (!isHydrationError) {
      originalError.apply(console, args)
      return
    }

    const isExtensionError = BROWSER_EXTENSION_ATTRIBUTES.some((attr) =>
      messages.some((message) => message.includes(attr))
    )

    if (isExtensionError) {
      return
    }

    logger.error('Hydration Error', {
      details: args,
      componentStack: messages.find((message) => message.includes('component stack')),
    })
    originalError.apply(console, args)
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

export const metadata: Metadata = generateBrandedMetadata()

function getPublicEnvSnapshot() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key.startsWith('NEXT_PUBLIC_') && typeof value === 'string'
    )
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publicEnv = JSON.stringify(getPublicEnvSnapshot()).replace(/</g, '\\u003c')

  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        {/* Basic head hints that are not covered by the Metadata API */}
        <meta name='color-scheme' content='light dark' />
        <meta name='format-detection' content='telephone=no' />
        <meta httpEquiv='x-ua-compatible' content='ie=edge' />
        <Script id='public-env' strategy='beforeInteractive'>
          {`window['${PUBLIC_ENV_KEY}'] = ${publicEnv};`}
        </Script>
      </head>
      <body suppressHydrationWarning>
        <PostHogProvider>
          <ThemeProvider>
            <QueryProvider>
              <SessionProvider>
                <ProviderModelsBootstrap />
                <TooltipProvider delayDuration={100} skipDelayDuration={0}>
                  <ZoomPrevention />
                  {children}
                </TooltipProvider>
              </SessionProvider>
            </QueryProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
