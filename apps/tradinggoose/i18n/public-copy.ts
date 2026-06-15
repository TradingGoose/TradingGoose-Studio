import type { Messages } from 'next-intl'
import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCopy from './messages/zh.json'
import { type AppLocale, defaultLocale, isLocaleCode } from './routing'

export type PublicCopy = Messages

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  zh: zhCopy,
} satisfies Record<AppLocale, PublicCopy>

export function getPublicCopy(locale: AppLocale | string | undefined): PublicCopy {
  const resolvedLocale = locale && isLocaleCode(locale) ? locale : defaultLocale
  return PUBLIC_COPY[resolvedLocale]
}

export function getClientMessages(
  locale: AppLocale | string | undefined,
  scope?: 'workspace' | 'admin'
) {
  const { admin, emails: _emails, workspace, ...messages } = getPublicCopy(locale)
  if (scope === 'workspace') return { nav: messages.nav, workspace }
  if (scope === 'admin')
    return { admin, nav: messages.nav, registration: messages.registration, workspace }
  return {
    ...messages,
    workspace: {
      nav: workspace.nav,
      userMenu: workspace.userMenu,
      settingsModal: workspace.settingsModal,
    },
  }
}
