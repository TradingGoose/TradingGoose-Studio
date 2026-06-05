import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { PublicEnvScript } from 'next-runtime-env'
import { generateBrandedMetadata } from '@/lib/branding/metadata'
import { PostHogProvider } from '@/lib/posthog/provider'
import { getClientMessages } from '@/i18n/public-copy'
import { type AppLocale, routing } from '@/i18n/routing'
import 'monaco-editor/min/vs/editor/editor.main.css'
import '@/app/globals.css'

import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionProvider } from '@/lib/session/session-context'
import { ProviderModelsBootstrap } from '@/app/provider-models-bootstrap'
import { QueryProvider } from '@/app/query-provider'
import { ThemeProvider } from '@/app/theme-provider'
import { ZoomPrevention } from '@/app/zoom-prevention'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return generateBrandedMetadata(
    hasLocale(routing.locales, locale) ? (locale as AppLocale) : routing.defaultLocale
  )
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <PublicEnvScript disableNextScript />
        {/* Basic head hints that are not covered by the Metadata API */}
        <meta name='color-scheme' content='light dark' />
        <meta name='format-detection' content='telephone=no' />
      </head>
      <body suppressHydrationWarning>
        <PostHogProvider>
          <ThemeProvider>
            <QueryProvider>
              <SessionProvider>
                <NextIntlClientProvider
                  key={locale}
                  locale={locale}
                  messages={getClientMessages(locale)}
                >
                  <ProviderModelsBootstrap />
                  <TooltipProvider delayDuration={100} skipDelayDuration={0}>
                    <ZoomPrevention />
                    {children}
                  </TooltipProvider>
                </NextIntlClientProvider>
              </SessionProvider>
            </QueryProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
