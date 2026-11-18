import type { Socket } from 'socket.io'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SocketAuth')

export interface AuthenticatedSocket extends Socket {
  userId?: string
}

export async function isSocketSessionActive(userId: string, sessionToken: string) {
  const { internalAdapter } = await auth.$context
  const current = await internalAdapter.findSession(sessionToken)
  return current?.user.id === userId && current.session.expiresAt.getTime() > Date.now()
}

export async function authenticateSocket(
  socket: AuthenticatedSocket,
  next: (error?: Error) => void
) {
  const token = socket.handshake.auth?.token
  const { origin, referer } = socket.handshake.headers

  logger.info(`Socket ${socket.id} authentication attempt:`, {
    hasToken: !!token,
    origin,
    referer,
  })

  if (!token) {
    logger.warn(`Socket ${socket.id} rejected: No authentication token found`)
    return next(new Error('Authentication required'))
  }

  try {
    const session = await auth.api.verifyOneTimeToken({ body: { token } })
    if (!session?.user?.id || !session.session.token) {
      logger.warn(`Socket ${socket.id} rejected: Invalid session`)
      return next(new Error('Invalid session'))
    }

    const userId = session.user.id
    const sessionToken = session.session.token
    socket.userId = userId
    const requireActiveSession = async () => {
      try {
        if (await isSocketSessionActive(userId, sessionToken)) return true
      } catch {
        logger.warn(`Socket ${socket.id} session lookup failed`)
        socket.conn.close(true)
        return false
      }
      socket.disconnect(true)
      return false
    }

    socket.use(async (_packet, nextPacket) => {
      if (await requireActiveSession()) nextPacket()
      else nextPacket(new Error('Invalid session'))
    })
    const onHeartbeat = ({ type }: { type: string }) => {
      if (type === 'pong') void requireActiveSession()
    }
    socket.conn.on('packet', onHeartbeat)
    socket.once('disconnect', () => socket.conn.off('packet', onHeartbeat))

    next()
  } catch (tokenError) {
    logger.warn(`Token validation failed for socket ${socket.id}:`, {
      error: tokenError instanceof Error ? tokenError.message : String(tokenError),
      stack: tokenError instanceof Error ? tokenError.stack : undefined,
      origin,
      referer,
    })
    next(new Error('Token validation failed'))
  }
}
