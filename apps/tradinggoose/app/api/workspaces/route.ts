import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { createWorkspace, getUserWorkspaces } from '@/lib/workspaces/service'

const logger = createLogger('Workspaces')
const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

// Get all workspaces for the current user
export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaces = await getUserWorkspaces({
    userId: session.user.id,
  })

  return NextResponse.json({ workspaces })
}

// POST /api/workspaces - Create a new workspace
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name } = createWorkspaceSchema.parse(await req.json())

    const newWorkspace = await createWorkspace(session.user.id, name)

    return NextResponse.json({ workspace: newWorkspace })
  } catch (error) {
    logger.error('Error creating workspace:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}
