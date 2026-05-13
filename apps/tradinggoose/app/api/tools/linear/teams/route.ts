import type { Team } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearTeamsAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    const linearClient = new LinearClient({ accessToken: credential.accessToken })
    const teamsResult = await linearClient.teams()
    const teams = teamsResult.nodes.map((team: Team) => ({
      id: team.id,
      name: team.name,
    }))

    return NextResponse.json({ teams })
  } catch (error) {
    logger.error('Error processing Linear teams request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear teams', details: (error as Error).message },
      { status: 500 }
    )
  }
}
