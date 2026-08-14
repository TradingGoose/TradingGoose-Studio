/**
 * @vitest-environment jsdom
 */

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

function RetainedSheet({ open }: { open: boolean }) {
  const portalContainerRef = useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open}>
      <div ref={portalContainerRef} data-testid='portal-container' />
      <SheetContent
        keepMounted
        portalContainer={portalContainerRef}
        backdropClassName='test-backdrop'
        viewportClassName='test-viewport'
        closeClassName='test-close'
        data-testid='sheet-popup'
      >
        <SheetTitle>Copilot</SheetTitle>
        <div data-testid='retained-content' />
      </SheetContent>
    </Sheet>
  )
}

describe('SheetContent', () => {
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
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps content mounted in the requested portal container', async () => {
    await act(async () => root.render(<RetainedSheet open />))

    const portalContainer = container.querySelector('[data-testid="portal-container"]')
    const retainedContent = portalContainer?.querySelector('[data-testid="retained-content"]')
    expect(portalContainer?.querySelector('[data-testid="sheet-popup"]')).not.toBeNull()
    expect(portalContainer?.querySelector('.test-backdrop')).not.toBeNull()
    expect(portalContainer?.querySelector('.test-viewport')).not.toBeNull()
    expect(portalContainer?.querySelector('button.test-close')).not.toBeNull()

    await act(async () => root.render(<RetainedSheet open={false} />))
    expect(portalContainer?.querySelector('[data-testid="retained-content"]')).toBe(retainedContent)
  })
})
