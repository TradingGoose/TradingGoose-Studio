import { NextResponse } from 'next/server'
import {
  buildCopilotServerToolErrorResponse,
  StructuredServerToolError,
} from '@/lib/copilot/server-tool-errors'
import { toSavedEntityTransportError } from '@/lib/yjs/server/apply-entity-state'

export function createSavedEntityErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof StructuredServerToolError) {
    const response = buildCopilotServerToolErrorResponse(undefined, error)
    return NextResponse.json(response.body, { status: response.status })
  }
  const transportError = toSavedEntityTransportError(error)
  return transportError
    ? NextResponse.json(transportError.responseBody(), { status: transportError.status })
    : null
}
