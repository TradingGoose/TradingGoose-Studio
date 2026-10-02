/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { SubBlock } from '../../sub-block'
import { ListingSelectorInput } from './listing-selector'

const listingSelectorMock = vi.hoisted(() => vi.fn())
const credentialSelectorMock = vi.hoisted(() => vi.fn((_props: Record<string, unknown>) => null))
const subBlockValues = vi.hoisted(() => new Map<string, unknown>())
const setSubBlockValueMock = vi.hoisted(() => vi.fn())
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

vi.mock('@/components/listing-selector/selector/combo', () => ({
  ListingSelector: (props: Record<string, unknown>) => {
    listingSelectorMock(props)
    return null
  },
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, subBlockId: string) => [
      subBlockValues.get(subBlockId) ?? null,
      setSubBlockValueMock,
    ],
  })
)

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useBlock: () => ({
    subBlocks: Object.fromEntries([...subBlockValues].map(([id, value]) => [id, { value }])),
  }),
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components',
  async () => ({
    CredentialSelector: (await import('../credential-selector/credential-selector'))
      .CredentialSelector,
  })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector',
  () => ({ ToolCredentialSelector: credentialSelectorMock })
)

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowInspectorCopy: () => ({ workflowEditor: {} }),
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => ({
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    channelId: 'channel-1',
  }),
}))

vi.mock('@/hooks/use-tag-selection', () => ({
  useTagSelection: () => vi.fn(),
}))

const config = {
  id: 'listing',
  title: 'Listing',
  type: 'market-selector',
  providerType: 'market',
  tradingProviderFieldId: 'provider',
  dependsOn: ['provider'],
} satisfies SubBlockConfig

const unscopedConfig = {
  id: 'listing',
  title: 'Listing',
  type: 'market-selector',
  providerType: 'market',
} satisfies SubBlockConfig

describe('workflow market selectors', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    listingSelectorMock.mockClear()
    credentialSelectorMock.mockClear()
    setSubBlockValueMock.mockClear()
    subBlockValues.clear()
    useListingSelectorStore.setState({ instances: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it.each([
    ['nested without parent', undefined, { provider: 'robinhood' }, true],
    ['nested with unrelated parent', 'openai', { provider: 'robinhood' }, true],
    ['nested missing', 'robinhood', {}, false],
    ['nested blank', 'robinhood', { provider: '' }, false],
    ['nested non-OAuth', 'robinhood', { provider: 'polygon' }, false],
    ['standalone', 'robinhood', undefined, true],
  ] as const)(
    'resolves credentials from the %s provider',
    (_, parentProvider, contextValues, visible) => {
      const id = contextValues ? 'tools-tool-0-credentialId' : 'credentialId'
      subBlockValues.set('provider', parentProvider)
      subBlockValues.set(id, 'saved-credential')

      act(() => {
        root.render(
          <SubBlock
            blockId='block-1'
            config={{ id, type: 'oauth-input', providerType: 'market', dependsOn: ['provider'] }}
            isConnecting={false}
            contextValues={contextValues}
          />
        )
      })

      if (visible) {
        expect(credentialSelectorMock.mock.lastCall?.[0]).toMatchObject({
          provider: 'robinhood',
          value: 'saved-credential',
        })
      } else {
        expect(credentialSelectorMock).not.toHaveBeenCalled()
      }
    }
  )

  it('enables market selectors with a selected trading provider when the route market provider is empty', () => {
    subBlockValues.set('provider', 'alpaca')

    act(() => {
      root.render(<ListingSelectorInput blockId='block-1' subBlockId='listing' config={config} />)
    })

    expect(listingSelectorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        marketProviderId: undefined,
        tradingProviderId: 'alpaca',
      })
    )
  })

  it('enables market selectors without provider filters', () => {
    act(() => {
      root.render(
        <ListingSelectorInput blockId='block-1' subBlockId='listing' config={unscopedConfig} />
      )
    })

    expect(listingSelectorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        marketProviderId: undefined,
        tradingProviderId: undefined,
      })
    )
  })

  it('rejects enriched flat listing values', () => {
    const listingIdentity = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    subBlockValues.set('listing', { ...listingIdentity, base: 'AAPL', name: 'Apple Inc.' })

    act(() => {
      root.render(
        <ListingSelectorInput blockId='block-1' subBlockId='listing' config={unscopedConfig} />
      )
    })

    expect(useListingSelectorStore.getState().instances['block-1-listing']).toMatchObject({
      selectedListing: null,
    })
  })

  it('clears stale resolved data when the stored listing identity changes', () => {
    const aapl = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    const msft = { ...aapl, listing_id: 'MSFT' }
    subBlockValues.set('listing', msft)
    useListingSelectorStore.getState().ensureInstance('block-1-listing', {
      selectedListing: {
        listingIdentity: aapl,
        base: 'AAPL',
        name: 'Apple Inc.',
      },
    })

    act(() => {
      root.render(
        <ListingSelectorInput blockId='block-1' subBlockId='listing' config={unscopedConfig} />
      )
    })

    expect(useListingSelectorStore.getState().instances['block-1-listing']).toMatchObject({
      selectedListing: msft,
    })
  })

  it('keeps empty fetched listing candidates stable while options load', () => {
    const fetchedConfig = {
      ...unscopedConfig,
      fetchOptionsCondition: { field: 'operation', value: 'removeListing' },
      fetchOptions: vi.fn(() => new Promise<never>(() => {})),
    } satisfies SubBlockConfig
    const props = {
      blockId: 'block-1',
      subBlockId: 'listing',
      config: fetchedConfig,
      contextValues: { operation: 'removeListing' },
    }

    act(() => {
      root.render(<ListingSelectorInput {...props} />)
    })
    const firstCandidates = listingSelectorMock.mock.calls.at(-1)?.[0]?.candidateListings

    act(() => {
      root.render(
        <ListingSelectorInput
          {...props}
          config={{ ...fetchedConfig }}
          contextValues={{ operation: 'removeListing' }}
        />
      )
    })
    const secondCandidates = listingSelectorMock.mock.calls.at(-1)?.[0]?.candidateListings

    expect(firstCandidates).toEqual([])
    expect(secondCandidates).toBe(firstCandidates)
    expect(fetchedConfig.fetchOptions).toHaveBeenCalledTimes(1)
  })
})
