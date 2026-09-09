import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'es', 'zh'],
  hideLocale: 'default-locale',
  parser: 'dir',
})

export type DocsLocale = (typeof i18n.languages)[number]

export function isDocsLocale(locale: string): locale is DocsLocale {
  return i18n.languages.includes(locale as DocsLocale)
}
