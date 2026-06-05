'use client'

import type { ReactNode } from 'react'
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl'
import type { PublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export type LandingMarketPreviewMessages = {
  workspace: {
    widgets: Pick<PublicCopy['workspace']['widgets'], 'dataChart'>
  }
}

interface LandingMarketPreviewProviderProps {
  children: ReactNode
  messages: LandingMarketPreviewMessages
}

export function LandingMarketPreviewProvider({
  children,
  messages,
}: LandingMarketPreviewProviderProps) {
  const locale = useLocale() as LocaleCode
  const parentMessages = useMessages() as Partial<PublicCopy>
  const mergedMessages = {
    ...parentMessages,
    workspace: {
      ...parentMessages.workspace,
      widgets: {
        ...parentMessages.workspace?.widgets,
        dataChart: messages.workspace.widgets.dataChart,
      },
    },
  }

  return (
    <NextIntlClientProvider locale={locale} messages={mergedMessages}>
      {children}
    </NextIntlClientProvider>
  )
}
