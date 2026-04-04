import { setupConnectionHandlers } from '@/socket-server/handlers/connection'
import { setupMarketHandlers } from '@/socket-server/handlers/market'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'

/**
 * Sets up all socket event handlers for an authenticated socket connection
 * @param socket - The authenticated socket instance
 */
export function setupAllHandlers(socket: AuthenticatedSocket) {
  setupConnectionHandlers(socket)
  setupMarketHandlers(socket)
}

export {
  setupConnectionHandlers,
  setupMarketHandlers,
}
