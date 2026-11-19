/** @vitest-environment jsdom */

import { EventEmitter } from 'node:events'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { SocketProvider, useSocket } from './socket-context'

const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: ioMock }))
vi.mock('@/lib/env', () => ({ getEnv: () => undefined }))
vi.mock('@/lib/auth/auth-error-handler', () => ({ handleAuthError: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/workspace' }))

class TestSocket extends EventEmitter {
  connected = false
  active = true
  io = {
    engine: {
      close: vi.fn(() => {
        this.connected = false
        this.emit('disconnect', 'forced close')
      }),
    },
  }
  connect = vi.fn(() => {
    this.active = true
    return this
  })
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

it.each([500, 'network', 401] as const)(
  'keeps token-service failures separate from authentication rejection (%s)',
  async (failure) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() =>
          failure === 'network'
            ? Promise.reject(new TypeError('Failed to fetch'))
            : Promise.resolve(new Response(null, { status: failure }))
        )
        .mockResolvedValue(Response.json({ token: 'retry-token', userId: 'user-1' }))
    )
    const shared = new TestSocket()
    ioMock.mockReturnValue(shared)
    const providerSockets: ReturnType<typeof useSocket>[] = []
    function Probe({ index }: { index: number }) {
      providerSockets[index] = useSocket()
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() =>
      root.render(
        <>
          {[0, 1].map((index) => (
            <SocketProvider key={index} userId='user-1'>
              <Probe index={index} />
            </SocketProvider>
          ))}
        </>
      )
    )
    const authenticate = ioMock.mock.calls[0][1].auth
    const handshake = vi.fn(({ token }) => {
      if (!token) return shared.emit('connect_error', new Error('Authentication required'))
      shared.connected = true
      shared.emit('connect')
    })
    try {
      await act(async () => authenticate(handshake))
      expect(handshake).not.toHaveBeenCalled()
      expect(shared.io.engine.close).toHaveBeenCalledOnce()
      expect(shared.active).toBe(failure !== 401)
      expect(shared.connect).not.toHaveBeenCalled()
      expect(handleAuthError).toHaveBeenCalledTimes(failure === 401 ? 1 : 0)
      expect(providerSockets).toEqual([shared, shared])
      expect(shared.connected).toBe(false)

      if (failure !== 401) {
        await act(async () => authenticate(handshake))
        expect(handshake).toHaveBeenCalledWith({ token: 'retry-token' })
        expect(shared.connected).toBe(true)
        expect(handleAuthError).not.toHaveBeenCalled()
        act(() => shared.emit('connect_error', new Error('Invalid session')))
        expect(handleAuthError).toHaveBeenCalledWith('socket-auth', '/workspace')
      }
    } finally {
      act(() => root.unmount())
    }
  }
)

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
    let currentSocket!: ReturnType<typeof useSocket>
    function Probe() {
      currentSocket = useSocket()
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <StrictMode>
          <SocketProvider userId='user-1'>
            <Probe />
          </SocketProvider>
        </StrictMode>
      )
    )
    if (unmountBeforeAuth) act(() => root.unmount())
    await act(async () => resolveToken(Response.json({ token: 'test-token', userId: 'user-1' })))

    if (!unmountBeforeAuth) {
      expect(currentSocket?.connected).toBe(true)
      expect(sockets.filter((socket) => socket.active)).toEqual([currentSocket])
      expect(globalThis.__socketRegistry?.get('user-1')?.socket).toBe(currentSocket)
      act(() => root.unmount())
    }
    expect(sockets.every((socket) => !socket.active)).toBe(true)
    expect(globalThis.__socketRegistry?.size).toBe(0)
  }
)

it('reauthenticates a shared socket after server disconnect and releases its final owner', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ioMock.mockImplementation(() => new TestSocket())
  const providerSockets: ReturnType<typeof useSocket>[] = []
  function Probe({ index }: { index: number }) {
    providerSockets[index] = useSocket()
    return null
  }
  const root = createRoot(document.createElement('div'))
  const renderProviders = (userId?: string, showFirst = true) =>
    act(() =>
      root.render(
        <>
          {showFirst && (
            <SocketProvider key='first' userId={userId}>
              <Probe index={0} />
            </SocketProvider>
          )}
          <SocketProvider key='second' userId='user-1'>
            <Probe index={1} />
          </SocketProvider>
        </>
      )
    )
  renderProviders('user-1')
  const shared = providerSockets[0] as unknown as TestSocket
  expect(providerSockets[1]).toBe(shared)
  expect(ioMock).toHaveBeenCalledTimes(1)
  act(() => {
    shared.connected = true
    shared.emit('connect')
  })

  const fetchToken = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ token: 'replacement-token', userId: 'user-1' }))
    .mockResolvedValueOnce(Response.json({ token: 'new-owner-token', userId: 'user-2' }))
  vi.stubGlobal('fetch', fetchToken)
  act(() => {
    shared.connected = false
    shared.active = false
    shared.emit('disconnect', 'io server disconnect')
  })
  expect(shared.connect).toHaveBeenCalledOnce()
  expect(shared.connected).toBe(false)
  await act(async () =>
    ioMock.mock.calls[0][1].auth(({ token }: { token: string }) => {
      expect(token).toBe('replacement-token')
      shared.connected = true
      shared.emit('connect')
    })
  )
  expect(fetchToken).toHaveBeenCalledOnce()
  expect(shared.connected).toBe(true)

  renderProviders('user-2')
  const other = providerSockets[0] as unknown as TestSocket
  expect(shared.active).toBe(true)
  expect(other).not.toBe(shared)
  expect(providerSockets[1]).toBe(shared)
  renderProviders('user-1')
  expect(other.active).toBe(false)
  expect(providerSockets[0]).toBe(shared)

  renderProviders()
  expect(providerSockets[0]).toBeNull()
  expect(shared.active).toBe(true)
  renderProviders('user-1')
  expect(ioMock).toHaveBeenCalledTimes(2)
  renderProviders(undefined, false)
  expect(shared.active).toBe(true)
  expect(shared.listenerCount('disconnect')).toBe(1)
  act(() => {
    shared.connected = false
    shared.active = false
    shared.emit('disconnect', 'io server disconnect')
  })
  const handshake = vi.fn()
  await act(async () => ioMock.mock.calls[0][1].auth(handshake))
  expect(handshake).not.toHaveBeenCalled()
  expect(shared.active).toBe(false)
  expect(handleAuthError).not.toHaveBeenCalled()
  act(() => root.unmount())
  expect(shared.active).toBe(false)
  expect(shared.listenerCount('disconnect')).toBe(0)
  expect(globalThis.__socketRegistry?.size).toBe(0)
})
