import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listOAuthConnectionsForUser } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import type { OAuthProvider } from '@/lib/oauth'
import { parseProvider } from '@/lib/oauth'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OAuthConnectionsAPI')

/**
 * Get all OAuth connections for the current user
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const credentials = await listOAuthConnectionsForUser({ userId: session.user.id })
    const connectionsByProvider = new Map<string, any>()
    for (const credential of credentials) {
      const { baseProvider, featureType } = parseProvider(credential.provider as OAuthProvider)
      const existing = connectionsByProvider.get(credential.provider)
      if (existing) {
        existing.scopes = Array.from(new Set([...existing.scopes, ...(credential.scopes ?? [])]))
        existing.lastConnected =
          new Date(credential.lastUsed).getTime() > new Date(existing.lastConnected).getTime()
            ? credential.lastUsed
            : existing.lastConnected
        existing.accounts.push({
          id: credential.id,
          name: credential.name,
        })
        continue
      }

      connectionsByProvider.set(credential.provider, {
        provider: credential.provider,
        baseProvider,
        featureType,
        isConnected: true,
        scopes: credential.scopes ?? [],
        lastConnected: credential.lastUsed,
        accounts: [
          {
            id: credential.id,
            name: credential.name,
          },
        ],
      })
    }

    return NextResponse.json(
      { connections: Array.from(connectionsByProvider.values()) },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth connections`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
