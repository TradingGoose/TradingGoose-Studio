/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { ListingSelectorDropdownContent } from './dropdown'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ListingSelectorDropdownContent localized copy', () => {
  let container: HTMLDivElement
  let root: Root

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

  const renderWithLocale = async (
    locale: 'en' | 'es' | 'zh',
    props: Partial<ComponentProps<typeof ListingSelectorDropdownContent>> = {}
  ) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <ListingSelectorDropdownContent
            groups={[{ id: 'all', label: 'All' }]}
            activeGroupId='all'
            onActiveGroupChange={vi.fn()}
            results={[]}
            isLoading={false}
            highlightedIndex={-1}
            onHighlightChange={vi.fn()}
            onSelect={vi.fn()}
            {...props}
          />
        </NextIntlClientProvider>
      )
    })
  }

  it('renders the loading state in Spanish from centralized listing selector copy', async () => {
    await renderWithLocale('es', { isLoading: true })

    expect(container.textContent).toContain(
      getPublicCopy('es').workspace.widgets.listingSelector.searching
    )
  })

  it('renders the empty state in Chinese from centralized listing selector copy', async () => {
    await renderWithLocale('zh')

    expect(container.textContent).toContain(
      getPublicCopy('zh').workspace.widgets.listingSelector.noListingsFound
    )
  })

  it('keeps explicit errors ahead of the empty-state fallback', async () => {
    await renderWithLocale('es', { error: 'backend error' })

    expect(container.textContent).toContain('backend error')
    expect(container.textContent).not.toContain(
      getPublicCopy('es').workspace.widgets.listingSelector.noListingsFound
    )
  })
})
