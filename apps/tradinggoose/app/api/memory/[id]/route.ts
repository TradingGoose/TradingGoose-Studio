import { db } from '@tradinggoose/db'
import { memory } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { MemoryMessageSchema, memoryError } from '../utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const WorkflowIdSchema = z.string().trim().min(1)
const UpdateMemorySchema = z.object({ workflowId: WorkflowIdSchema, data: MemoryMessageSchema })
type RouteContext = { params: Promise<{ id: string }> }

async function authorize(request: NextRequest, workflowId: string, access: 'read' | 'write') {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  return authorizeWorkflowScope(auth, workflowId, access)
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const scope = await authorize(
      request,
      new URL(request.url).searchParams.get('workflowId') || '',
      'read'
    )
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: { message: scope.error } },
        { status: scope.status }
      )
    }
    const [record] = await db
      .select()
      .from(memory)
      .where(
        and(eq(memory.workflowId, scope.workflowId), eq(memory.key, id), isNull(memory.deletedAt))
      )
      .limit(1)
    if (!record) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true, data: record })
  } catch (error) {
    return memoryError(error)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const scope = await authorize(
      request,
      new URL(request.url).searchParams.get('workflowId') || '',
      'write'
    )
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: { message: scope.error } },
        { status: scope.status }
      )
    }
    const [record] = await db
      .delete(memory)
      .where(
        and(eq(memory.workflowId, scope.workflowId), eq(memory.key, id), isNull(memory.deletedAt))
      )
      .returning({ id: memory.id })
    if (!record) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true, data: { message: 'Memory deleted successfully' } })
  } catch (error) {
    return memoryError(error)
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }
    const { id } = await params
    const body = UpdateMemorySchema.parse(await request.json())
    const scope = await authorizeWorkflowScope(auth, body.workflowId, 'write')
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: { message: scope.error } },
        { status: scope.status }
      )
    }
    const [record] = await db
      .update(memory)
      .set({ data: [body.data], updatedAt: new Date() })
      .where(
        and(
          eq(memory.workflowId, scope.workflowId),
          eq(memory.key, id),
          eq(memory.type, 'agent'),
          isNull(memory.deletedAt)
        )
      )
      .returning()
    if (!record) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true, data: record })
  } catch (error) {
    return memoryError(error)
  }
}
