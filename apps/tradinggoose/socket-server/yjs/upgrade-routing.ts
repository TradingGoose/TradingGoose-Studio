import type { IncomingMessage, Server as HttpServer } from 'http'
import type { Duplex } from 'stream'

export type UpgradeListener = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void

export function isYjsUpgradeRequest(request: IncomingMessage): boolean {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname
  return pathname.startsWith('/yjs/')
}

export function shieldNonYjsUpgradeListeners(
  httpServer: HttpServer,
  yjsUpgradeListener: UpgradeListener
): void {
  const listeners = httpServer.listeners('upgrade') as UpgradeListener[]

  if (listeners.length === 0) {
    return
  }

  httpServer.removeAllListeners('upgrade')

  for (const listener of listeners) {
    if (listener === yjsUpgradeListener) {
      httpServer.on('upgrade', listener)
      continue
    }

    httpServer.on('upgrade', (request, socket, head) => {
      if (isYjsUpgradeRequest(request)) {
        return
      }

      return listener(request, socket, head)
    })
  }
}
