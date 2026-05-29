/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider, useMessages } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPublicCopy, getScopedPublicMessages } from '@/i18n/public-copy'
import { useDataChartCopy } from '@/widgets/widgets/data_chart/copy'
import {
  LandingMarketPreviewProvider,
  type LandingMarketPreviewMessages,
} from './landing-market-preview-provider'

function MarketPreviewMessagesProbe() {
  const appMessages = useMessages() as {
    landing: {
      preview: {
        shell: {
          headerAriaLabel: string
        }
      }
    }
    workspace: {
      widgets: Record<string, unknown>
    }
  }
  const dataChartCopy = useDataChartCopy()

  return (
    <div data-testid='market-preview-messages'>
      {appMessages.landing.preview.shell.headerAriaLabel} |{' '}
      {dataChartCopy.controls.candleTypes.candle_solid} |{' '}
      {Object.keys(appMessages.workspace.widgets).join(',')}
    </div>
  )
}

describe('LandingMarketPreviewProvider', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('adds only the data-chart message slice while preserving landing copy from the outer provider', async () => {
    const copy = getPublicCopy('en')
    const messages: LandingMarketPreviewMessages = {
      workspace: {
        widgets: {
          dataChart: copy.workspace.widgets.dataChart,
        },
      },
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale='en'
          messages={getScopedPublicMessages('en', ['landing'] as const)}
        >
          <LandingMarketPreviewProvider messages={messages}>
            <MarketPreviewMessagesProbe />
          </LandingMarketPreviewProvider>
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(copy.landing.preview.shell.headerAriaLabel)
    expect(container.textContent).toContain(copy.workspace.widgets.dataChart.controls.candleTypes.candle_solid)
    expect(container.textContent).toContain('dataChart')
    expect(container.textContent).not.toContain('workflowEditor')
  })
})
