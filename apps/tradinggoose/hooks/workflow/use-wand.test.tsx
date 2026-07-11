/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWand } from '@/hooks/workflow/use-wand'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn() }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

type Wand = ReturnType<typeof useWand>

function deferredResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController
      },
    }),
    { status: 200 }
  )
  return { controller, response }
}

describe('useWand request authorization', () => {
  let container: HTMLDivElement
  let root: Root
  let current: Wand
  const onStreamChunk = vi.fn()
  const onGeneratedContent = vi.fn()
  const onGenerationComplete = vi.fn()

  const Harness = ({ enabled }: { enabled: boolean }) => {
    current = useWand({
      wandConfig: { enabled, prompt: 'Generate {context}' },
      currentValue: 'current',
      onStreamChunk,
      onGeneratedContent,
      onGenerationComplete,
    })
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('aborts and suppresses retained callbacks when generation becomes disabled', async () => {
    const deferred = deferredResponse()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal
      return deferred.response
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<Harness enabled={true} />))

    let generation!: Promise<void>
    await act(async () => {
      generation = current.generateStream({ prompt: 'first' })
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    })
    await act(async () => root.render(<Harness enabled={false} />))
    expect(requestSignal?.aborted).toBe(true)

    deferred.controller.enqueue(
      new TextEncoder().encode('data: {"chunk":"forbidden","done":true}\n\n')
    )
    deferred.controller.close()
    await act(async () => generation)

    expect(onStreamChunk).not.toHaveBeenCalled()
    expect(onGeneratedContent).not.toHaveBeenCalled()
    expect(onGenerationComplete).not.toHaveBeenCalled()
    expect(current.isStreaming).toBe(false)
  })

  it('does not let an older request clear a newer request state', async () => {
    const first = deferredResponse()
    const second = deferredResponse()
    const responses = [first.response, second.response]
    const fetchMock = vi.fn(async () => responses.shift()!)
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<Harness enabled={true} />))

    let firstGeneration!: Promise<void>
    let secondGeneration!: Promise<void>
    await act(async () => {
      firstGeneration = current.generateStream({ prompt: 'first' })
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      secondGeneration = current.generateStream({ prompt: 'second' })
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })

    first.controller.enqueue(new TextEncoder().encode('data: {"chunk":"old"}\n\n'))
    first.controller.close()
    await act(async () => firstGeneration)
    expect(current.isStreaming).toBe(true)

    second.controller.enqueue(new TextEncoder().encode('data: {"chunk":"new"}\n\n'))
    second.controller.close()
    await act(async () => secondGeneration)

    expect(onStreamChunk).toHaveBeenCalledWith('new')
    expect(onGeneratedContent).toHaveBeenCalledWith('new')
    expect(current.isStreaming).toBe(false)
  })
})
