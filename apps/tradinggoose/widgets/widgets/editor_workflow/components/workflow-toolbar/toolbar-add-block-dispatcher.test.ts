import { beforeEach, describe, expect, it, vi } from 'vitest'

const MODULE_PATH =
  '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher'

describe('toolbar add-block dispatcher', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('routes add-block requests only to the matching widget scope', async () => {
    const { registerToolbarAddBlockHandler, dispatchToolbarAddBlock } = await import(MODULE_PATH)

    const scopeAHandler = vi.fn()
    const scopeBHandler = vi.fn()

    registerToolbarAddBlockHandler('widget-a', scopeAHandler)
    registerToolbarAddBlockHandler('widget-b', scopeBHandler)

    const handled = dispatchToolbarAddBlock({ type: 'agent' }, 'widget-a')

    expect(handled).toBe(true)
    expect(scopeAHandler).toHaveBeenCalledTimes(1)
    expect(scopeBHandler).not.toHaveBeenCalled()
  })

  it('uses the latest handler for the same widget scope', async () => {
    const { registerToolbarAddBlockHandler, dispatchToolbarAddBlock } = await import(MODULE_PATH)

    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    registerToolbarAddBlockHandler('widget-main', firstHandler)
    registerToolbarAddBlockHandler('widget-main', secondHandler)

    dispatchToolbarAddBlock({ type: 'condition' }, 'widget-main')

    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest handler after older unsubscribe and removes active handler on cleanup', async () => {
    const { registerToolbarAddBlockHandler, dispatchToolbarAddBlock } = await import(MODULE_PATH)

    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    const unsubscribeFirst = registerToolbarAddBlockHandler('widget-main', firstHandler)
    const unsubscribeSecond = registerToolbarAddBlockHandler('widget-main', secondHandler)

    unsubscribeFirst()
    dispatchToolbarAddBlock({ type: 'loop' }, 'widget-main')
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledTimes(1)

    unsubscribeSecond()
    const handledAfterCleanup = dispatchToolbarAddBlock({ type: 'loop' }, 'widget-main')
    expect(handledAfterCleanup).toBe(false)
  })
})
