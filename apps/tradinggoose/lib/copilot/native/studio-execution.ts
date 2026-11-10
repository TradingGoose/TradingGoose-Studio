import { z } from 'zod'
import { REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'
import { parseNativeContract, type Scope, type Target } from './contract'

const nativeTargetEnvelope = z
  .object({ workspaceId: z.string().min(1).nullable(), target: z.unknown() })
  .strict()
export type StudioNativeTarget = { workspaceId: Scope['workspaceId']; target: Target }
export async function parseStudioNativeTarget(value: unknown): Promise<StudioNativeTarget> {
  const input = nativeTargetEnvelope.parse(value)
  return {
    workspaceId: input.workspaceId,
    target: await parseNativeContract('Target', input.target),
  }
}

const executionEnvelope = z
  .object({
    native: nativeTargetEnvelope,
    action: z.enum(['execute', 'review.accept', 'review.reject', 'readback']),
    accessLevel: z.enum(['limited', 'full']).optional(),
    reviewToken: z.string().min(1).optional(),
    context: z
      .object({
        contextEntityKind: z.enum(REVIEW_ENTITY_KINDS).optional(),
        contextEntityId: z.string().min(1).optional(),
        workspaceId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    readback: z
      .object({ credentialId: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()

export type StudioNativeExecutionRequest = Omit<z.infer<typeof executionEnvelope>, 'native'> & {
  native: { workspaceId: Scope['workspaceId']; target: Target }
}

export async function parseStudioNativeExecutionRequest(
  value: unknown
): Promise<StudioNativeExecutionRequest> {
  const request = executionEnvelope.parse(value)
  const reviewDecision = request.action === 'review.accept' || request.action === 'review.reject'
  if (reviewDecision && !request.reviewToken) {
    throw new Error('reviewToken is required for a server tool review decision')
  }
  if (!reviewDecision && request.reviewToken) {
    throw new Error('reviewToken is only permitted for review.accept or review.reject')
  }
  if (request.action !== 'readback' && request.readback) {
    throw new Error('Readback references cannot execute a business operation')
  }
  return {
    ...request,
    native: {
      ...request.native,
      target: await parseNativeContract('Target', request.native.target),
    },
  }
}
