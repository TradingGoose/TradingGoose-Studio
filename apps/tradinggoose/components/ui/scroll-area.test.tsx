/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScrollArea } from '@/components/ui/scroll-area'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ScrollArea', () => {
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

  it('applies viewportClassName to the Radix viewport', async () => {
    await act(async () => {
      root.render(
        <ScrollArea className='root-class' viewportClassName='viewport-class'>
          <div>content</div>
        </ScrollArea>
      )
    })

    const rootElement = container.firstElementChild
    const viewport = container.querySelector('[data-radix-scroll-area-viewport]')

    expect(rootElement?.className).toContain('root-class')
    expect(viewport?.className).toContain('viewport-class')
  })
})
