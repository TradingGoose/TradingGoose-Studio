import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { appendWorkflowMemory, getAllWorkflowMemory } from '@/lib/mastra/workflow-memory'
import { MemoryMessageSchema, memoryError, requireMemoryAuth } from './utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const CreateMemorySchema = z
  .object({
    key: z.string().trim().min(1),
    type: z.literal('agent'),
    workflowId: z.string().trim().min(1),
    data: MemoryMessageSchema,
  })
  .strict()
const ListMemorySchema = z.object({ workflowId: z.string().trim().min(1) }).strict()

export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    const authenticatedAt = performance.now()
    requireMemoryAuth(auth)
    const { workflowId } = ListMemorySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    const memories = await getAllWorkflowMemory(auth, workflowId, request.signal, authenticatedAt)
    return NextResponse.json(
      { success: true, data: { memories } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return memoryError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    const authenticatedAt = performance.now()
    requireMemoryAuth(auth)
    const body = CreateMemorySchema.parse(await request.json())
    const { record, created } = await appendWorkflowMemory(
      auth,
      body.workflowId,
      body.key,
      body.data,
      request.signal,
      authenticatedAt
    )
    return NextResponse.json(
      { success: true, data: record },
      { status: created ? 201 : 200, headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return memoryError(error)
  }
}
