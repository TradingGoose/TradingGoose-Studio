/**
 * @vitest-environment node
 */

import { createServer, type IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import {
  isYjsUpgradeRequest,
  shieldNonYjsUpgradeListeners,
  type UpgradeListener,
} from './upgrade-routing'

function createUpgradeRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: 'localhost:3002' },
  } as IncomingMessage
}

function createSocket(): Duplex {
  return {} as Duplex
}

describe('upgrade-routing', () => {
  it('detects Yjs upgrade paths', () => {
    expect(isYjsUpgradeRequest(createUpgradeRequest('/yjs/workflow-1'))).toBe(true)
    expect(isYjsUpgradeRequest(createUpgradeRequest('/socket.io/?EIO=4&transport=websocket'))).toBe(
      false
    )
  })

  it('prevents non-Yjs upgrade listeners from handling Yjs paths', () => {
    const httpServer = createServer()
    const yjsListener = vi.fn<UpgradeListener>()
    const socketIoListener = vi.fn<UpgradeListener>()

    httpServer.on('upgrade', yjsListener)
    httpServer.on('upgrade', socketIoListener)

    shieldNonYjsUpgradeListeners(httpServer, yjsListener)

    httpServer.emit('upgrade', createUpgradeRequest('/yjs/workflow-1'), createSocket(), Buffer.alloc(0))

    expect(yjsListener).toHaveBeenCalledTimes(1)
    expect(socketIoListener).not.toHaveBeenCalled()
  })

  it('still allows non-Yjs upgrade listeners on non-Yjs paths', () => {
    const httpServer = createServer()
    const yjsListener = vi.fn<UpgradeListener>()
    const socketIoListener = vi.fn<UpgradeListener>()

    httpServer.on('upgrade', yjsListener)
    httpServer.on('upgrade', socketIoListener)

    shieldNonYjsUpgradeListeners(httpServer, yjsListener)

    httpServer.emit(
      'upgrade',
      createUpgradeRequest('/socket.io/?EIO=4&transport=websocket'),
      createSocket(),
      Buffer.alloc(0)
    )

    expect(yjsListener).toHaveBeenCalledTimes(1)
    expect(socketIoListener).toHaveBeenCalledTimes(1)
  })
})
