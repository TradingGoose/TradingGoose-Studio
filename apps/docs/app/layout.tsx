import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

export const metadata = {
  metadataBase: new URL('https://docs.tradinggoose.ai'),
  title: {
    default: 'TradingGoose Documentation - Visual Workflow Builder for AI Applications',
    template: '%s',
  },
  description:
    'Comprehensive documentation for TradingGoose - the visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.',
  keywords: [
    'AI workflow builder',
    'visual workflow editor',
    'AI automation',
    'workflow automation',
    'AI agents',
    'no-code AI',
    'drag and drop workflows',
    'AI integrations',
    'workflow canvas',
    'AI Agent Workflow Builder',
    'workflow orchestration',
    'agent builder',
    'AI workflow automation',
    'visual programming',
  ],
  authors: [{ name: 'TradingGoose Team', url: 'https://tradinggoose.ai' }],
  creator: 'TradingGoose',
  publisher: 'TradingGoose',
  category: 'Developer Tools',
  classification: 'Developer Documentation',
  manifest: '/favicon/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
    shortcut: '/favicon/favicon.ico',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TradingGoose Docs',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['es_ES', 'fr_FR', 'de_DE', 'ja_JP', 'zh_CN'],
    url: 'https://docs.tradinggoose.ai',
    siteName: 'TradingGoose Documentation',
    title: 'TradingGoose Documentation - Visual Workflow Builder for AI Applications',
    description:
      'Comprehensive documentation for TradingGoose - the visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TradingGoose Documentation - Visual Workflow Builder for AI Applications',
    description:
      'Comprehensive documentation for TradingGoose - the visual workflow builder for AI applications.',
    creator: '@tradinggoose',
    site: '@tradinggoose',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://docs.tradinggoose.ai',
    languages: {
      'x-default': 'https://docs.tradinggoose.ai',
      en: 'https://docs.tradinggoose.ai',
      es: 'https://docs.tradinggoose.ai/es',
      fr: 'https://docs.tradinggoose.ai/fr',
      de: 'https://docs.tradinggoose.ai/de',
      ja: 'https://docs.tradinggoose.ai/ja',
      zh: 'https://docs.tradinggoose.ai/zh',
    },
  },
}
