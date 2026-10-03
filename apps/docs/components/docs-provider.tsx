'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useEffect } from 'react'
import { type Framework, FrameworkProvider } from 'fumadocs-core/framework'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { RootProvider } from 'fumadocs-ui/provider/base'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  DOCS_LOCALE_COOKIE,
  DOCS_LOCALE_MAX_AGE,
  type DocsLocale,
  getDocsPathname,
  getLocalizedDocsHref,
  i18n,
  isDocsLocale,
} from '@/lib/i18n'

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: { displayName: 'English' },
    es: { displayName: 'Español' },
    zh: { displayName: '中文' },
  },
})

function DocsLink({ href, ...props }: ComponentProps<typeof Link>) {
  const { lang } = useParams<{ lang: string }>()
  return (
    <Link
      {...props}
      href={
        typeof href === 'string' && isDocsLocale(lang) ? getLocalizedDocsHref(href, lang) : href
      }
    />
  )
}

// Markdown links and cards share this adapter with the documentation navigation.
const framework: Framework = {
  Link: DocsLink as Framework['Link'],
  Image: Image as Framework['Image'],
  useParams,
  useRouter,
  usePathname,
}

function rememberLocale(locale: DocsLocale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${DOCS_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${DOCS_LOCALE_MAX_AGE}; SameSite=Lax${secure}`
}

export function DocsProvider({ locale, children }: { locale: DocsLocale; children: ReactNode }) {
  useEffect(() => {
    // Remember actual page visits, never speculative prefetch requests.
    rememberLocale(locale)
  }, [locale])

  return (
    <FrameworkProvider {...framework}>
      <RootProvider
        i18n={{
          ...provider(locale),
          onLocaleChange(nextLocale) {
            if (!isDocsLocale(nextLocale)) return
            rememberLocale(nextLocale)
            if (nextLocale === locale) return
            const url = new URL(window.location.href)
            url.pathname = getLocalizedDocsHref(getDocsPathname(url.pathname), nextLocale)
            // Load the language-specific document and rerun theme initialization.
            window.location.assign(url.href)
          },
        }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  )
}
