import { createNavigation } from 'next-intl/navigation'
import { localizeUrl } from './utils'
import { routing } from './routing'

// These navigation helpers localize canonical internal paths like `/verify`.
// Do not pre-localize hrefs before passing them to this router.
export const { Link, usePathname, useRouter, redirect, getPathname } = createNavigation(routing)

// Locale switches cross the localized document boundary so server-owned JSON-LD
// remains part of the initial document instead of being inserted by React.
export function replaceLocaleDocument(locale: typeof routing.locales[number], pathname: string) {
  if (typeof window === 'undefined') {
    return
  }

  document.cookie = `NEXT_LOCALE=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`
  window.location.replace(localizeUrl(window.location.origin, locale, pathname))
}
