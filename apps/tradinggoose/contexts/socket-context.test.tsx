/** @vitest-environment jsdom */

import { EventEmitter } from 'node:events'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SocketProvider, useSocket } from './socket-context'

const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: ioMock }))
vi.mock('@/lib/env', () => ({ getEnv: () => undefined }))
vi.mock('@/lib/auth/auth-error-handler', () => ({ handleAuthError: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/workspace' }))

class TestSocket extends EventEmitter {
  connected = false
  active = true
  disconnect() {
    this.connected = false
    this.active = false
    return this
  }
}

afterEach(() => {
  globalThis.__socketRegistry = undefined
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([false, true])(
  'owns socket cleanup across StrictMode while authentication is pending (unmount: %s)',
  async (unmountBeforeAuth) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let resolveToken!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveToken = resolve
          })
      )
    )
    const sockets: TestSocket[] = []
    ioMock.mockImplementation((_url, options) => {
      const socket = new TestSocket()
      sockets.push(socket)
      queueMicrotask(() => {
        if (!socket.active) return
        options.auth(() => {
          if (!socket.active) return
          socket.connected = true
          socket.emit('connect')
        })
      })
      return socket
    })
    let state!: ReturnType<typeof useSocket>
    function Probe() {
      state = useSocket()
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <StrictMode>
          <SocketProvider user={{ id: 'user-1' }}>
            <Probe />
          </SocketProvider>
        </StrictMode>
      )
    )
    if (unmountBeforeAuth) act(() => root.unmount())
    await act(async () => resolveToken(new Response(JSON.stringify({ token: 'test-token' }))))

    if (!unmountBeforeAuth) {
      expect(state.isConnected).toBe(true)
      expect(state.isConnecting).toBe(false)
      expect(sockets.filter((socket) => socket.active)).toEqual([state.socket])
      expect(globalThis.__socketRegistry?.get('user-1')?.socket).toBe(state.socket)
      act(() => root.unmount())
    }
    expect(sockets.every((socket) => !socket.active)).toBe(true)
    expect(globalThis.__socketRegistry?.size).toBe(0)
  }
)

it('keeps a shared socket until its final provider releases it', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ioMock.mockImplementation(() => new TestSocket())
  const states: ReturnType<typeof useSocket>[] = []
  function Probe({ index }: { index: number }) {
    states[index] = useSocket()
    return null
  }
  const root = createRoot(document.createElement('div'))
  const renderProviders = (userId?: string, showFirst = true) =>
    act(() =>
      root.render(
        <>
          {showFirst && (
            <SocketProvider key='first' user={userId ? { id: userId } : undefined}>
              <Probe index={0} />
            </SocketProvider>
          )}
          <SocketProvider key='second' user={{ id: 'user-1' }}>
            <Probe index={1} />
          </SocketProvider>
        </>
      )
    )
  renderProviders('user-1')
  const shared = states[0].socket as unknown as TestSocket
  expect(states[1].socket).toBe(shared)
  expect(ioMock).toHaveBeenCalledTimes(1)
  act(() => {
    shared.connected = true
    shared.emit('connect')
  })
  expect(states.every((state) => state.isConnected)).toBe(true)

  renderProviders('user-2')
  const other = states[0].socket as unknown as TestSocket
  expect(shared.active).toBe(true)
  expect(states[0].isConnected).toBe(false)
  expect(states[1].isConnected).toBe(true)
  renderProviders('user-1')
  expect(other.active).toBe(false)
  expect(states[0].socket).toBe(shared)
  expect(states[0].isConnected).toBe(true)

  renderProviders()
  expect(states[0]).toEqual({ socket: null, isConnected: false, isConnecting: false })
  expect(shared.active).toBe(true)
  renderProviders('user-1')
  expect(ioMock).toHaveBeenCalledTimes(2)
  renderProviders(undefined, false)
  expect(shared.active).toBe(true)
  expect(shared.listenerCount('connect')).toBe(1)
  act(() => root.unmount())
  expect(shared.active).toBe(false)
  expect(shared.listenerCount('connect')).toBe(0)
  expect(globalThis.__socketRegistry?.size).toBe(0)
})
