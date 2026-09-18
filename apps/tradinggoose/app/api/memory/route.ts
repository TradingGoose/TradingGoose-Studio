import { db } from '@tradinggoose/db'
import { memory } from '@tradinggoose/db/schema'
import { and, eq, isNull, like, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { MemoryMessageSchema, memoryError } from './utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CreateMemorySchema = z.object({
  key: z.string().trim().min(1),
  type: z.literal('agent'),
  workflowId: z.string().trim().min(1),
  data: MemoryMessageSchema,
})
const SearchMemorySchema = z.object({
  workflowId: z.string().trim().min(1),
  query: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }
    const params = SearchMemorySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const scope = await authorizeWorkflowScope(auth, params.workflowId, 'read')
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: { message: scope.error } },
        { status: scope.status }
      )
    }
    const memories = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.workflowId, scope.workflowId),
          isNull(memory.deletedAt),
          params.type ? eq(memory.type, params.type) : undefined,
          params.query ? like(memory.key, `%${params.query}%`) : undefined
        )
      )
      .orderBy(memory.createdAt)
      .limit(params.limit)
    return NextResponse.json({ success: true, data: { memories } })
  } catch (error) {
    return memoryError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }
    const body = CreateMemorySchema.parse(await request.json())
    const scope = await authorizeWorkflowScope(auth, body.workflowId, 'write')
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: { message: scope.error } },
        { status: scope.status }
      )
    }
    const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()
    const [record] = await db
      .insert(memory)
      .values({
        id,
        workflowId: scope.workflowId,
        key: body.key,
        type: 'agent',
        data: [body.data],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workflowId, memory.key],
        set: {
          data: sql`(${memory.data}::jsonb || ${JSON.stringify([body.data])}::jsonb)::json`,
          updatedAt: now,
        },
        setWhere: and(eq(memory.type, 'agent'), isNull(memory.deletedAt)),
      })
      .returning()
    if (!record) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory ID is unavailable for agent messages' } },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { success: true, data: record },
      { status: record.id === id ? 201 : 200 }
    )
  } catch (error) {
    return memoryError(error)
  }
}
