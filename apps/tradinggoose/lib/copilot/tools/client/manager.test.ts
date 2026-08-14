import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disposeAllClientTools,
  getClientTool,
  registerClientTool,
} from '@/lib/copilot/tools/client/manager'

describe('client tool manager', () => {
  afterEach(() => {
    disposeAllClientTools()
  })

  it('disposes the previous instance when replacing a tool call registration', () => {
    const previous = { dispose: vi.fn() }
    const replacement = { dispose: vi.fn() }

    registerClientTool('tool-call-1', previous)
    registerClientTool('tool-call-1', replacement)

    expect(previous.dispose).toHaveBeenCalledOnce()
    expect(replacement.dispose).not.toHaveBeenCalled()
    expect(getClientTool('tool-call-1')).toBe(replacement)
  })

  it('does not dispose an instance when registering the same instance again', () => {
    const instance = { dispose: vi.fn() }

    registerClientTool('tool-call-1', instance)
    registerClientTool('tool-call-1', instance)

    expect(instance.dispose).not.toHaveBeenCalled()
    expect(getClientTool('tool-call-1')).toBe(instance)
  })
})
