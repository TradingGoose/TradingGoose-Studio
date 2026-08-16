/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { CopilotSidebarToggle } from '@/global-navbar/components/copilot-sidebar-toggle'
import { getPublicCopy } from '@/i18n/public-copy'

const mobileState = vi.hoisted(() => ({ value: false }))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobileState.value,
}))

function ControlledToggle({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return <CopilotSidebarToggle open={open} onOpenChange={setOpen} />
}

describe('CopilotSidebarToggle', () => {
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
    mobileState.value = false
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderToggle = async (children: ReactNode, sidebarOpen = false) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <SidebarProvider open={sidebarOpen} onOpenChange={() => undefined}>
            {children}
          </SidebarProvider>
        </NextIntlClientProvider>
      )
    })
  }

  it('renders a switch above the collapsed-state button when the sidebar is open', async () => {
    await renderToggle(<ControlledToggle initialOpen />, true)

    const toggle = container.querySelector('[data-slot="switch"]')
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('Expected an open-sidebar copilot switch')
    }

    expect(toggle.getAttribute('aria-label')).toBe('Hide Copilot')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('toggles the panel from the collapsed sidebar button', async () => {
    await renderToggle(<ControlledToggle initialOpen={false} />)

    const button = container.querySelector('button[aria-pressed]')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected a collapsed-sidebar copilot button')
    }

    expect(button.getAttribute('aria-label')).toBe('Show Copilot')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button).toHaveClass('data-[active=true]:bg-primary')
    expect(button).toHaveClass('data-[active=true]:text-primary-foreground')
    expect(container.querySelector('[data-slot="switch"]')).toBeNull()

    await act(async () => {
      button.click()
    })

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Hide Copilot')
  })

  it('does not expose the desktop Copilot panel on mobile', async () => {
    mobileState.value = true
    const onOpenChange = vi.fn()

    await renderToggle(<CopilotSidebarToggle open onOpenChange={onOpenChange} />)

    expect(container.querySelector('button[aria-pressed]')).toBeNull()
    expect(container.querySelector('[data-slot="switch"]')).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
