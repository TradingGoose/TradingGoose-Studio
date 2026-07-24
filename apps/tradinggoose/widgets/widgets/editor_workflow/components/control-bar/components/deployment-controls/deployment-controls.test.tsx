/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DeploymentControls } from './deployment-controls'

const mocks = vi.hoisted(() => ({ modalOpen: false }))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/components/ui/tooltip', () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <>{children}</>
  return { Tooltip: Wrapper, TooltipContent: Wrapper, TooltipTrigger: Wrapper }
})
vi.mock('@/widgets/widgets/editor_workflow/components/control-bar/components', () => ({
  DeployModal: ({ open }: { open: boolean }) => {
    mocks.modalOpen = open
    return null
  },
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useDeploymentCopy: () => new Proxy({}, { get: (_target, key) => String(key) }),
}))

it('closes an open deploy modal when the workflow becomes read-only', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { userPermissions: { canAdmin: true } } as any
  const render = async (canEdit: boolean) => {
    await act(async () => {
      root.render(<DeploymentControls {...props} canEdit={canEdit} />)
    })
  }

  await render(true)
  act(() => container.querySelector('button')?.click())
  expect(mocks.modalOpen).toBe(true)
  await render(false)
  expect(container.querySelector('button')?.disabled).toBe(true)
  expect(mocks.modalOpen).toBe(false)
  act(() => root.unmount())
})
