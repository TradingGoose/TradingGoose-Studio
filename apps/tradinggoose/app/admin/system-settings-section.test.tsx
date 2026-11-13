/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AdminSystemSettingsEditableFields } from '@/lib/admin/system-settings/types'
import { useModelRegistry } from '@/stores/model-registry'
import { AdminSystemSettingsSection } from './system-settings-section'

const fixture = vi.hoisted(() => ({
  update: vi.fn(),
  snapshot: {
    registrationMode: 'open' as const,
    billingEnabled: false,
    stripeConfigured: false,
    billingReady: false,
    triggerDevEnabled: false,
    triggerReady: false,
    allowPromotionCodes: true,
    emailDomain: 'tradinggoose.ai',
    fromEmailAddress: '',
    copilot: {
      models: [{ provider: 'openai' as const, model: 'current-model' }],
    },
  },
}))
vi.mock('@/hooks/queries/admin-system-settings', () => ({
  adminSystemSettingsKeys: { snapshot: () => ['admin-system-settings', 'snapshot'] },
  useAdminSystemSettingsSnapshot: () => ({
    data: fixture.snapshot,
    isPending: false,
    isError: false,
  }),
  updateAdminSystemSettings: fixture.update,
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalRegistry = useModelRegistry.getState()
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label || candidate.getAttribute('aria-label') === label
  )!

beforeEach(async () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  useModelRegistry.setState({
    providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'openai/current-model' }] }],
    isLoading: false,
    error: undefined,
    load: async () => {},
  })
  fixture.update.mockImplementation(async (input: Partial<AdminSystemSettingsEditableFields>) => ({
    ...fixture.snapshot,
    ...input,
  }))
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['provider-icons'], {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminSystemSettingsSection />
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
  useModelRegistry.setState(originalRegistry)
})

it('saves the catalog atomically and refreshes public model and admin service queries', async () => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  expect(button('Save system settings')).toBeDisabled()
  await act(async () => button('Add model').click())
  expect(button('Save system settings')).toBeDisabled()
  await act(async () => container.querySelector<HTMLButtonElement>('#copilot-model-1')!.click())
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Model"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'openai/future-model-not-in-registry'
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const candidate = [
    ...document.querySelectorAll<HTMLButtonElement>('button[data-option-index]'),
  ].find((button) => button.textContent?.trim() === 'openai/future-model-not-in-registry')!
  expect(candidate).toBeDefined()
  await act(async () => candidate.click())
  expect(button('Save system settings')).toBeEnabled()
  await act(async () => button('Save system settings').click())
  expect(fixture.update).toHaveBeenCalledOnce()
  expect(fixture.update.mock.calls[0][0]).toEqual({
    copilot: {
      models: [
        { provider: 'openai', model: 'current-model' },
        { provider: 'openai', model: 'future-model-not-in-registry' },
      ],
    },
  })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['copilot-models'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-services', 'snapshot'] })
  expect(button('Save system settings')).toBeDisabled()
})

it('recognizes an equivalent catalog after adding and removing a draft row', async () => {
  await act(async () => button('Add model').click())
  await act(async () => button('Remove model row 2').click())
  expect(button('Save system settings')).toBeDisabled()
  expect(fixture.update).not.toHaveBeenCalled()
})

it('keeps unsaved model edits visible when saving fails', async () => {
  fixture.update.mockRejectedValueOnce(new Error('failed_to_update_system_settings'))
  await act(async () => button('Remove model row 1').click())
  await act(async () => button('Save system settings').click())
  expect(container.querySelector('[role="alert"]')).toHaveTextContent(
    'Failed to update system settings.'
  )
  expect(container.textContent).toContain('No models configured')
  expect(button('Save system settings')).toBeEnabled()
})
