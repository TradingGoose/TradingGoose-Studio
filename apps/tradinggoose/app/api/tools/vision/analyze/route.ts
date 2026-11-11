import { Agent } from '@mastra/core/agent'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { getFailureAccounting, safeInferenceError } from '@/lib/mastra/errors'
import { normalizeNativeMediaMessages } from '@/lib/mastra/media'
import { NATIVE_AGENT_POLICY, trustedModelSettings } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { assertNativeCompletion } from '@/lib/mastra/result'
import { getMastra } from '@/lib/mastra/runtime'
import { resultAccounting, selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import {
  downloadFileFromStorage,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-processing'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('VisionAnalyzeAPI')

const VisionAnalyzeSchema = z.object({
  apiKey: z.string().optional(),
  imageUrl: z.string().optional().nullable(),
  imageFile: z.any().optional().nullable(),
  model: z.string().optional().default('openai/gpt-4o'),
  prompt: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  let requestApiKey: string | undefined
  let failureAccounting: Record<string, unknown> = {}
  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Vision analyze attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Vision analyze request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const scope: { workflowId?: string; workspaceId?: string } = {}
    const query = new URL(request.url).searchParams
    for (const field of ['workflowId', 'workspaceId'] as const) {
      const values = query.getAll(field)
      if (values.length > 1 || (values.length === 1 && !values[0].trim()))
        return NextResponse.json({ success: false, error: `Invalid ${field}` }, { status: 400 })
      scope[field] = values[0]?.trim()
    }
    if (authResult.workspaceId && scope.workspaceId && scope.workspaceId !== authResult.workspaceId)
      return NextResponse.json(
        { success: false, error: 'Workspace conflicts with authenticated API key' },
        { status: 403 }
      )
    scope.workspaceId = authResult.workspaceId ?? scope.workspaceId

    const body = await request.json()
    const validatedData = VisionAnalyzeSchema.parse(body)
    requestApiKey = validatedData.apiKey
    try {
      assertListedModel(validatedData.model)
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Select a listed model' },
        { status: 400 }
      )
    }

    if (!validatedData.imageUrl && !validatedData.imageFile) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either imageUrl or imageFile is required',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Analyzing image`, {
      hasFile: !!validatedData.imageFile,
      hasUrl: !!validatedData.imageUrl,
      model: validatedData.model,
    })

    let imageSource: string | Uint8Array = validatedData.imageUrl || ''
    let imageMimeType: string | undefined

    if (validatedData.imageFile) {
      const rawFile = validatedData.imageFile
      logger.info(`[${requestId}] Processing image file: ${rawFile.name}`)

      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process image file',
          },
          { status: (error as { status?: number })?.status === 403 ? 403 : 400 }
        )
      }

      const buffer = await downloadFileFromStorage(userFile, requestId, logger, {
        actorUserId: authResult.userId,
        workspaceId: scope.workspaceId,
        signal: request.signal,
      })

      imageSource = buffer
      imageMimeType = userFile.type
      logger.info(`[${requestId}] Read image (${buffer.length} bytes)`)
    }

    const defaultPrompt = 'Please analyze this image and describe what you see in detail.'
    const prompt = validatedData.prompt || defaultPrompt
    const messages = await normalizeNativeMediaMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image: imageSource, mediaType: imageMimeType },
          ],
        },
      ],
      { actorUserId: authResult.userId, workspaceId: scope.workspaceId, signal: request.signal }
    )

    const startedAt = new Date()
    const mastra = await getMastra()
    const finance = await usageProcessors({
      actorUserId: authResult.userId,
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
      runId: requestId,
      purpose: 'vision',
      signal: request.signal,
    })
    const admittedModel = createConfiguredLanguageModel(validatedData.model, validatedData.apiKey)
    const agent = new Agent({
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
      ...NATIVE_AGENT_POLICY,
      mastra,
      id: 'vision',
      name: 'Vision',
      instructions: 'Analyze the supplied image according to the user prompt.',
      model: admittedModel,
    })
    const correlation = {
      runId: requestId,
      userId: authResult.userId,
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
      startedAt,
    }
    const steps: any[] = []
    let usage
    let result
    let accounting
    try {
      result = await agent.generate(messages, {
        runId: requestId,
        abortSignal: request.signal,
        modelSettings: trustedModelSettings({ maxOutputTokens: 1024 }),
        maxProcessorRetries: 0,
        tracingOptions: {
          metadata: { userId: authResult.userId, resourceId: scope.workspaceId },
        },
        onStepFinish: (step) => {
          steps.push(step)
        },
      })
      usage = result.totalUsage || result.usage
      assertNativeCompletion(result)
      await finance.verifyComplete()
      if (
        request.signal.aborted ||
        ['abort', 'aborted', 'error'].includes(result.finishReason || '') ||
        result.error
      ) {
        throw new Error(
          `Vision generation ${request.signal.aborted ? 'aborted' : result.finishReason || 'failed'}`
        )
      }
      if (typeof result.text !== 'string' || !result.text.trim()) {
        throw new Error(
          'Vision generation returned no analysis. Check the selected model and image support.'
        )
      }
    } finally {
      accounting = await resultAccounting(
        selectNativeUsage(usage, finance.getUsage(), sumNativeUsage(steps))
      )
      failureAccounting = { model: validatedData.model, ...accounting }
    }

    logger.info(`[${requestId}] Image analyzed successfully`)

    return NextResponse.json({
      success: true,
      output: {
        content: result.text,
        model: validatedData.model,
        tokens: accounting.tokens.total,
        usage: {
          input_tokens: accounting.tokens.prompt,
          output_tokens: accounting.tokens.completion,
          total_tokens: accounting.tokens.total,
        },
        cost: accounting.cost,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error analyzing image:`, error)
    return NextResponse.json(
      {
        success: false,
        error: safeInferenceError(error, requestApiKey),
        ...failureAccounting,
        ...getFailureAccounting(error),
      },
      {
        status:
          error instanceof z.ZodError
            ? 400
            : [400, 403].includes((error as { status?: number })?.status ?? 0)
              ? (error as { status: number }).status
              : 500,
      }
    )
  }
}
