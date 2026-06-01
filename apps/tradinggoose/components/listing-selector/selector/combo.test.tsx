/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { ListingSelector } from './combo'

describe('ListingSelector localized wrapper copy', () => {
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
    useListingSelectorStore.setState({ instances: {} })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders the wrapper label from centralized listing selector copy in Spanish', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <ListingSelector instanceId='listing-selector-test' />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(getPublicCopy('es').workspace.widgets.listingSelector.label)
    expect(container.textContent).not.toContain('Listing')
  })
})
