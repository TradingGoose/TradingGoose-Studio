import type { Project } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearProjectsAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const { teamId } = body

    if (!teamId) {
      logger.error('Missing teamId in request')
      return NextResponse.json({ error: 'Credential and teamId are required' }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    const linearClient = new LinearClient({ accessToken: credential.accessToken })
    let projects = []

    const team = await linearClient.team(teamId)
    const projectsResult = await team.projects()
    projects = projectsResult.nodes.map((project: Project) => ({
      id: project.id,
      name: project.name,
    }))

    if (projects.length === 0) {
      logger.info('No projects found for team', { teamId })
    }

    return NextResponse.json({ projects })
  } catch (error) {
    logger.error('Error processing Linear projects request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear projects', details: (error as Error).message },
      { status: 500 }
    )
  }
}
