import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { PublicEnvScript } from 'next-runtime-env'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PostHogProvider } from '@/lib/posthog/provider'
import { SessionProvider } from '@/lib/session/session-context'
import { AppBootstrap } from '@/app/app-bootstrap'
import { AppCommandMenu, ThemedToaster } from '@/app/app-command-menu'
import { QueryProvider } from '@/app/query-provider'
import { ThemeProvider } from '@/app/theme-provider'
import { ZoomPrevention } from '@/app/zoom-prevention'
import { getClientMessages } from '@/i18n/public-copy'
import 'monaco-editor/min/vs/editor/editor.main.css'
import '@/app/globals.css'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <PublicEnvScript disableNextScript />
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
                  <AppBootstrap />
                  <TooltipProvider delay={100} timeout={0}>
                    <ZoomPrevention />
                    <div className='isolate'>{children}</div>
                    <AppCommandMenu />
                    <ThemedToaster />
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
