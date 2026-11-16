import { isRunFenceConflictError } from '@mastra/core/storage'
import type { ErrorResponse } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { safeInferenceError } from '@/lib/mastra/errors'

export function copilotFailure(error: unknown, apiKey?: string): ErrorResponse {
  const ownershipLost = isRunFenceConflictError(error)
  const status = ownershipLost ? 409 : error instanceof NativeTargetError ? error.status : 503
  return {
    status: status < 500 ? 'refused' : 'failed',
    error: {
      code:
        status === 403
          ? 'FORBIDDEN'
          : status === 409
            ? 'STALE_TARGET'
            : status < 500
              ? 'INVALID_REQUEST'
              : 'GENERATION_FAILED',
      message: ownershipLost
        ? 'This conversation changed before the request completed.'
        : safeInferenceError(error, apiKey),
    },
  }
}
