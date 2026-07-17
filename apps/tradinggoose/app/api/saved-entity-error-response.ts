import { NextResponse } from 'next/server'
import { toSavedEntityTransportError } from '@/lib/yjs/server/apply-entity-state'

export function createSavedEntityErrorResponse(error: unknown): NextResponse | null {
  const transportError = toSavedEntityTransportError(error)
  return transportError
    ? NextResponse.json(transportError.responseBody(), { status: transportError.status })
    : null
}
