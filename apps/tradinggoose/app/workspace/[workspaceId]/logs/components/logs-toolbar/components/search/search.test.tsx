/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { createSearchClause } from '@/lib/logs/query-parser'
import { AutocompleteSearch } from './search'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('AutocompleteSearch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('does not emit onChange while hydrating a non-empty external value', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <AutocompleteSearch
          value='workflow:#wf-1'
          onChange={onChange}
          queryPolicy={MONITOR_QUERY_POLICY}
        />
      )
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('workflow:#wf-1')
  })

  it('renders external clauses separately and removes them through the provided callback', async () => {
    const onRemoveExternalClause = vi.fn()
    const providerClause = createSearchClause(
      {
        kind: 'field',
        field: 'provider',
        negated: false,
        operator: '=',
        valueMode: 'id',
        values: ['alpaca'],
      },
      MONITOR_QUERY_POLICY
    )

    await act(async () => {
      root.render(
        <AutocompleteSearch
          value=''
          onChange={vi.fn()}
          queryPolicy={MONITOR_QUERY_POLICY}
          externalClauses={[providerClause]}
          onRemoveExternalClause={onRemoveExternalClause}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('provider:#alpaca')
    )

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected external clause badge to render')
    }

    await act(async () => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onRemoveExternalClause).toHaveBeenCalledWith(providerClause)
  })

  it('clears only the text badge and preserves committed clauses', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <AutocompleteSearch
          value='workflow:#wf-1 alpha'
          onChange={onChange}
          queryPolicy={MONITOR_QUERY_POLICY}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('text:') && node.textContent?.includes('alpha')
    )

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected text badge to render')
    }

    await act(async () => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('workflow:#wf-1')
    expect(container.textContent).toContain('workflow:#wf-1')
    expect(container.textContent).not.toContain('alpha')
  })
})
