/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode, useEffect, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
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

function MobileControlledToggle() {
  const { openMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)

  useEffect(() => setOpenMobile(true), [setOpenMobile])

  return (
    <>
      <CopilotSidebarToggle open={open} onOpenChange={setOpen} />
      <output data-testid='mobile-sidebar-state'>{String(openMobile)}</output>
    </>
  )
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

  it('closes the mobile sidebar before opening Copilot', async () => {
    mobileState.value = true

    await renderToggle(<MobileControlledToggle />)

    const toggle = container.querySelector('button[aria-pressed]')
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('Expected a mobile copilot toggle')
    }

    expect(container.querySelector('[data-testid="mobile-sidebar-state"]')).toHaveTextContent(
      'true'
    )

    await act(async () => toggle.click())

    expect(container.querySelector('[data-testid="mobile-sidebar-state"]')).toHaveTextContent(
      'false'
    )
  })
})
