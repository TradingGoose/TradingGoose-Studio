/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUsernameAvailability } from './username'

const { check } = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ client: { isUsernameAvailable: check } }))

function Candidate({ value, current }: { value: string; current?: string }) {
  return <output>{useUsernameAvailability(value, current)}</output>
}

describe('native username availability', () => {
  let root: Root | null
  let container: HTMLDivElement
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    check.mockReset()
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root?.unmount())
    queryClient.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  async function render(value: string, current?: string) {
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Candidate value={value} current={current} />
        </QueryClientProvider>
      )
    })
  }
  async function advance(milliseconds = 0) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds))
  }

  it('skips blank inputs and the account’s own normalized username', async () => {
    await render('  ')
    expect(container.textContent).toBe('idle')
    await render('  MiXeD.Name  ', 'mixed.name')
    await advance(500)
    expect(container.textContent).toBe('idle')
    expect(check).not.toHaveBeenCalled()
  })

  it.each([
    [{ data: { available: true }, error: null }, 'available'],
    [{ data: { available: false }, error: null }, 'taken'],
    [{ data: null, error: { status: 503, message: 'Unavailable' } }, 'error'],
  ] as const)('distinguishes native result %j as %s', async (response, expected) => {
    check.mockResolvedValue(response)
    await render('  MiXeD.Name  ')
    await advance()
    expect(container.textContent).toBe(expected)
    expect(check).toHaveBeenCalledExactlyOnceWith(
      { username: 'mixed.name' },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('debounces rapid typing and aborts an obsolete request before checking the new candidate', async () => {
    check
      .mockImplementationOnce(
        (_body, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
      .mockResolvedValue({ data: { available: true }, error: null })
    await render('')
    await render('first')
    await advance(200)
    await render('second')
    await advance(299)
    expect(container.textContent).toBe('checking')
    expect(check).not.toHaveBeenCalled()
    await advance(1)
    const signal = check.mock.calls[0][1].signal as AbortSignal
    expect(check.mock.calls[0][0]).toEqual({ username: 'second' })

    await render('third')
    expect(signal.aborted).toBe(true)
    expect(container.textContent).toBe('checking')
    await advance(300)
    await advance()
    expect(check).toHaveBeenCalledTimes(2)
    expect(check.mock.calls[1][0]).toEqual({ username: 'third' })
    expect(container.textContent).toBe('available')
  })

  it('never publishes an older response for the current candidate even if transport ignores abort', async () => {
    let completeOld!: (value: { data: { available: boolean }; error: null }) => void
    check
      .mockReturnValueOnce(
        new Promise((resolve) => {
          completeOld = resolve
        })
      )
      .mockResolvedValue({ data: { available: false }, error: null })
    await render('old.name')
    await render('new.name')
    await advance(300)
    await advance()
    expect(container.textContent).toBe('taken')
    await act(async () => completeOld({ data: { available: true }, error: null }))
    await advance()
    expect(container.textContent).toBe('taken')
  })

  it('aborts a pending native check on unmount', async () => {
    check.mockImplementation(
      (_body, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    await render('pending.name')
    const signal = check.mock.calls[0][1].signal as AbortSignal
    await act(async () => root!.unmount())
    root = null
    expect(signal.aborted).toBe(true)
    await advance(500)
    expect(check).toHaveBeenCalledOnce()
  })
})
