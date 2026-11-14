import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { deleteWorkflowMemory, getWorkflowMemory } from '@/lib/mastra/workflow-memory'
import { memoryError, requireMemoryAuth } from '../utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const ScopeSchema = z.object({ workflowId: z.string().trim().min(1) }).strict()
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    requireMemoryAuth(auth)
    const { id } = await params
    const { workflowId } = ScopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const record = await getWorkflowMemory(
      auth,
      workflowId,
      z.string().min(1).parse(id),
      request.signal
    )
    return NextResponse.json(
      { success: true, data: record },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return memoryError(error)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    requireMemoryAuth(auth)
    const { id } = await params
    const { workflowId } = ScopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    await deleteWorkflowMemory(auth, workflowId, z.string().min(1).parse(id), request.signal)
    return NextResponse.json({ success: true, data: { message: 'Memory deleted successfully' } })
  } catch (error) {
    return memoryError(error)
  }
}
