import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingAccounting,
  generateEmbeddings,
} from '@/lib/embeddings/utils'
import { safeInferenceError } from '@/lib/mastra/errors'
import { assertListedEmbeddingModel } from '@/lib/mastra/registry'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

const schema = z
  .object({
    input: z.union([z.string(), z.array(z.string()).min(1)]),
    model: z.string().default(DEFAULT_EMBEDDING_MODEL),
    apiKey: z
      .string()
      .refine((key) => key.trim().length > 0, 'A nonempty request-local API key is required'),
  })
  .strict()
const scopeId = z
  .string()
  .min(1)
  .refine((id) => id.trim() === id)

function output(embeddings: number[][], accounting: EmbeddingAccounting) {
  return {
    embeddings,
    model: accounting.model,
    tokens: accounting.tokens,
    cost: accounting.cost,
    embeddingUsage: accounting.usage,
  }
}

export async function POST(request: NextRequest) {
  let requestKey: string | undefined
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId)
      return NextResponse.json(
        { success: false, error: 'Authentication with an actual user is required' },
        { status: 401 }
      )
    const data = schema.parse(await request.json())
    requestKey = data.apiKey
    const model = await assertListedEmbeddingModel(data.model)
    if (model.provider !== 'openai')
      return NextResponse.json(
        { success: false, error: 'Select a listed OpenAI embedding model' },
        { status: 400 }
      )
    const query = request.nextUrl.searchParams
    for (const name of ['workflowId', 'workspaceId'])
      if (query.getAll(name).length > 1)
        return NextResponse.json(
          { success: false, error: `Supply only one ${name}` },
          { status: 400 }
        )
    const workflowId = query.has('workflowId') ? scopeId.parse(query.get('workflowId')) : null
    let workspaceId = query.has('workspaceId') ? scopeId.parse(query.get('workspaceId')) : null
    let executionId: string | undefined
    if (workflowId) {
      const owner = await authorizeWorkflowScope(auth, workflowId, 'read')
      if (!owner.ok)
        return NextResponse.json({ success: false, error: owner.error }, { status: owner.status })
      if (workspaceId && workspaceId !== owner.workspaceId)
        return NextResponse.json(
          { success: false, error: 'Workspace scope differs from the workflow' },
          { status: 403 }
        )
      workspaceId = owner.workspaceId
      executionId = owner.executionId
    } else if (workspaceId && !(await checkWorkspaceAccess(workspaceId, auth.userId)).hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Workspace access denied' },
        { status: 403 }
      )
    }
    const result = await generateEmbeddings(
      Array.isArray(data.input) ? data.input : [data.input],
      {
        actorUserId: auth.userId,
        workspaceId,
        workflowId,
        executionId,
        signal: request.signal,
        apiKey: data.apiKey,
        runId: randomUUID(),
      },
      data.model
    )
    return NextResponse.json({ success: true, output: output(result.embeddings, result) })
  } catch (error) {
    const message = safeInferenceError(error, requestKey)
    // The canonical helper attaches only completed native facts after an attempted operation.
    // Preserve them through the tool's ordinary HTTP200 application failure response.
    if (
      error &&
      typeof error === 'object' &&
      'embeddingUsage' in error &&
      'completedEmbeddings' in error
    ) {
      const failure = error as Error &
        EmbeddingAccounting & {
          embeddingUsage: EmbeddingAccounting['usage']
          completedEmbeddings: number[][]
        }
      return NextResponse.json({
        success: false,
        error: message,
        output: output(failure.completedEmbeddings, {
          model: failure.model,
          tokens: failure.tokens,
          cost: failure.cost,
          usage: failure.embeddingUsage,
        }),
      })
    }
    return NextResponse.json(
      { success: false, error: message },
      {
        status:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : error && typeof error === 'object' && 'status' in error && error.status === 400
              ? 400
              : 500,
      }
    )
  }
}
