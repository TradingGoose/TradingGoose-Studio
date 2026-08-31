import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'es', 'zh'],
  hideLocale: 'default-locale',
  parser: 'dir',
})

export type DocsLocale = (typeof i18n.languages)[number]

export const docsLocaleCopy: Record<
  DocsLocale,
  {
    displayName: string
    documentation: string
    description: string
    home: string
    team: string
    category: string
    siteName: string
  }
> = {
  en: {
    displayName: 'English',
    documentation: 'Documentation',
    description: 'TradingGoose visual workflow builder documentation for AI applications.',
    home: 'Home',
    team: 'TradingGoose Team',
    category: 'Developer Tools',
    siteName: 'TradingGoose Documentation',
  },
  es: {
    displayName: 'Español',
    documentation: 'Documentación',
    description: 'Documentación del editor visual de workflows de TradingGoose para aplicaciones de IA.',
    home: 'Inicio',
    team: 'Equipo de TradingGoose',
    category: 'Herramientas de desarrollo',
    siteName: 'Documentación de TradingGoose',
  },
  zh: {
    displayName: '简体中文',
    documentation: '文档',
    description: '面向 AI 应用的 TradingGoose 可视化 workflow 构建器文档。',
    home: '首页',
    team: 'TradingGoose 团队',
    category: '开发者工具',
    siteName: 'TradingGoose 文档',
  },
}

export function isDocsLocale(locale: string): locale is DocsLocale {
  return i18n.languages.includes(locale as DocsLocale)
}

export function toOpenGraphLocale(locale: DocsLocale) {
  return { en: 'en_US', es: 'es_ES', zh: 'zh_CN' }[locale]
}
