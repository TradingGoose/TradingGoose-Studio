/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWand } from './use-wand'

const completed = (text = 'Canonical result🔥') => ({
  done: true,
  result: {
    status: 'completed',
    runId: 'native-run',
    text,
  },
})
const encode = (frames: unknown[]) =>
  new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''))
function response(frames: unknown[], split = false) {
  return new Response(
    new ReadableStream({
      start(controller) {
        const bytes = encode(frames)
        if (split) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        else controller.enqueue(bytes)
        controller.close()
      },
    }),
    {}
  )
}
let root: Root
let host: HTMLDivElement
let api: ReturnType<typeof useWand>
let documentValue: string
let props: Parameters<typeof useWand>[0]
const generated = vi.fn()
const preview = vi.fn()
const ended = vi.fn()
function Harness() {
  api = useWand(props)
  return <div>{api.error}</div>
}
async function render() {
  await act(async () => root.render(<Harness />))
}
async function generate() {
  await act(async () => api.generateStream({ prompt: 'Improve' }))
}
beforeEach(async () => {
  vi.clearAllMocks()
  documentValue = 'original'
  props = {
    wandConfig: { enabled: true, prompt: 'Context {context}', maintainHistory: true },
    currentValue: 'original',
    generationKey: 'document-1',
    getCurrentValue: () => documentValue,
    onGeneratedContent: generated,
    onStreamChunk: preview,
    onGenerationEnd: ended,
  }
  generated.mockReturnValue(undefined)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  await render()
  ended.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response([{ chunk: 'Preview differs' }, completed()], true))
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('native wand success-only commit', () => {
  it('buffers split UTF8/SSE and commits exact done.result rather than partial chunks', async () => {
    await generate()
    expect(preview).toHaveBeenCalledExactlyOnceWith('Preview differs')
    expect(generated).toHaveBeenCalledExactlyOnceWith('Canonical result🔥')
    expect(api.conversationHistory).toEqual([
      { role: 'user', content: 'Improve' },
      { role: 'assistant', content: 'Canonical result🔥' },
    ])
    expect(api.error).toBeNull()
    expect(ended).toHaveBeenCalledOnce()
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).not.toHaveProperty('streaming')
  })
  it.each(['eof', 'bare-done', 'raw-sdk'])(
    'discards preview on %s without committing content/history',
    async (kind) => {
      const bad =
        kind === 'eof'
          ? [{ chunk: 'partial' }]
          : kind === 'bare-done'
            ? [{ done: true }]
            : [{ choices: [{ delta: { content: 'raw' } }] }]
      vi.mocked(fetch).mockResolvedValueOnce(response(bad))
      await generate()
      expect(generated).not.toHaveBeenCalled()
      expect(api.conversationHistory).toEqual([])
      expect(api.error).toBeTruthy()
      expect(ended).toHaveBeenCalledOnce()
    }
  )
  it.each(['error', 'cancelled'] as const)(
    'retains terminal %s completion state before discarding preview',
    async (kind) => {
      const terminal =
        kind === 'error'
          ? {
              error: 'Delivery failed',
              code: 'NATIVE_FAILURE',
              refusal: false,
            }
          : { cancelled: true }
      vi.mocked(fetch).mockResolvedValueOnce(response([{ chunk: 'partial' }, terminal]))
      await generate()
      expect(api.error).toBe(kind === 'error' ? 'Delivery failed' : 'Generation cancelled')
      expect(generated).not.toHaveBeenCalled()
      expect(api.conversationHistory).toEqual([])
    }
  )
  it('retains correlated collected refusal without converting it to acceptance or success', async () => {
    const failure = {
      status: 'refused',
      error: { code: 'QUOTA_EXCEEDED', message: 'Quota' },
    }
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(failure, { status: 402 }))
    await generate()
    expect(api.error).toBe('Quota')
    expect(generated).not.toHaveBeenCalled()
  })
  it('uses a direct document read to reject concurrent edits before React has rerendered', async () => {
    preview.mockImplementationOnce(() => {
      documentValue = 'Concurrent edit'
    })
    await generate()
    expect(generated).not.toHaveBeenCalled()
    expect(documentValue).toBe('Concurrent edit')
    expect(api.error).toContain('Document changed')
  })
  it('discards a cancelled request and late frames without clearing a newer successful generation', async () => {
    let firstResolve!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        firstResolve = resolve
      })
    )
    let first!: Promise<void>
    await act(async () => {
      first = api.generateStream({ prompt: 'First' })
    })
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal
    await act(async () => api.cancelGeneration())
    expect(signal.aborted).toBe(true)
    vi.mocked(fetch).mockResolvedValueOnce(response([completed('Newer')]))
    await generate()
    await act(async () => {
      firstResolve(response([completed('Late old')]))
      await first
    })
    expect(generated).toHaveBeenCalledExactlyOnceWith('Newer')
    expect(api.conversationHistory).toHaveLength(2)
    expect(api.isLoading).toBe(false)
  })
  it('rejects changed document identity/read-only state and clears history on target switch', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(value) {
            controller = value
          },
        }),
        {}
      )
    )
    let work!: Promise<void>
    await act(async () => {
      work = api.generateStream({ prompt: 'Old target' })
    })
    props = {
      ...props,
      generationKey: 'new-document',
      wandConfig: { ...props.wandConfig, enabled: false },
    }
    await render()
    await act(async () => {
      await work
    })
    expect(generated).not.toHaveBeenCalled()
    expect(api.conversationHistory).toEqual([])
    expect(api.isLoading).toBe(false)
    expect(() => controller.enqueue(encode([completed('Late')]))).toThrow()
  })
})
