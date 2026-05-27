/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { ListingSelectorInput } from './listing-selector'

const listingSelectorMock = vi.hoisted(() => vi.fn())
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

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate',
  () => ({
    useDependsOnGate: () => ({ finalDisabled: false }),
  })
)

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

describe('ListingSelectorInput', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    listingSelectorMock.mockClear()
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
})
