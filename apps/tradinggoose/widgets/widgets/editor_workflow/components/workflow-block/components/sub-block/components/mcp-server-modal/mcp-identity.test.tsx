/** @vitest-environment jsdom */
import { act, cloneElement, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { McpBlock } from '@/blocks/blocks/mcp'
import { McpDynamicArgs } from '../mcp-dynamic-args/mcp-dynamic-args'
import { McpServerSelector } from './mcp-server-selector'
import { McpToolSelector } from './mcp-tool-selector'

const state = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  error: null as string | null,
  loading: false,
  tools: [
    {
      id: 'opaque-a',
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'search',
      inputSchema: { type: 'object', properties: { alpha_query: { type: 'string' } } },
    },
    {
      id: 'opaque-b',
      serverId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'search',
      inputSchema: { type: 'object', properties: { beta_query: { type: 'string' } } },
    },
  ],
}))
vi.mock('@/hooks/use-mcp-tools', () => ({
  useMcpTools: () => ({
    mcpTools: state.tools,
    isLoading: state.loading,
    error: state.error,
    refreshTools: vi.fn(),
    getToolsByServer: (id: string) => state.tools.filter((tool) => tool.serverId === id),
  }),
}))
vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({
    members: state.tools.map((tool, index) => ({
      entityId: tool.serverId,
      entityName: `Server ${index}`,
      enabled: true,
    })),
    isLoading: false,
    error: null,
  }),
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkspaceId: () => 'workspace',
}))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_block: string, field: string) => [
      state.values[field],
      (value: unknown) => {
        state.values[field] = value
      },
    ],
  })
)
vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
}))
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandInput: () => null,
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button type='button' onClick={onSelect}>
      {children}
    </button>
  ),
}))

let root: Root
let container: HTMLDivElement
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  state.values = {
    server: state.tools[0].serverId,
    tool: 'search',
    arguments: { alpha_query: 'old' },
  }
  state.error = null
  state.loading = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('stores the exact tool name separately from its server', () => {
  state.values.tool = ''
  act(() => root.render(<McpToolSelector blockId='mcp' subBlock={McpBlock.subBlocks[1]} />))
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'search'
  )!
  act(() => button.click())
  expect(state.values.tool).toBe('search')
  expect(state.values.server).toBe(state.tools[0].serverId)
  expect(state.values).not.toHaveProperty('_toolSchema')
})

it('clears dependent inputs on server change and selects the same-name tool schema from that server', () => {
  act(() => root.render(<McpServerSelector blockId='mcp' subBlock={McpBlock.subBlocks[0]} />))
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Server 1'
  )!
  act(() => button.click())
  expect(state.values).toEqual({ server: state.tools[1].serverId, tool: '', arguments: {} })
  state.values.tool = 'search'
  act(() => root.render(<McpDynamicArgs blockId='mcp' subBlockId='arguments' />))
  expect(container.textContent).toContain('Beta Query')
  expect(container.textContent).not.toContain('Alpha Query')
})

it('reports a settled schema lookup failure instead of showing loading forever', () => {
  state.values.server = 'missing-server'
  state.error = 'Unavailable'
  act(() => root.render(<McpDynamicArgs blockId='mcp' subBlockId='arguments' />))
  expect(container.textContent).toContain('Error loading tools')
  expect(container.textContent).not.toContain('Loading tool schema')
})
