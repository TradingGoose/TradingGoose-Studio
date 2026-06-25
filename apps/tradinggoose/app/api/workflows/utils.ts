import { NextResponse } from 'next/server'
import {
  isWorkflowRealtimeRequiredError,
  WORKFLOW_REALTIME_REQUIRED_CODE,
} from '@/lib/workflows/db-helpers'

export function createErrorResponse(error: string, status: number, code?: string) {
  return NextResponse.json(
    {
      error,
      code: code || error.toUpperCase().replace(/\s+/g, '_'),
    },
    { status }
  )
}

export function createSuccessResponse(data: any) {
  return NextResponse.json(data)
}

export function createWorkflowRealtimeRequiredResponse(error: unknown) {
  if (!isWorkflowRealtimeRequiredError(error)) return null
  return createErrorResponse(
    'Workflow realtime orchestration is required',
    503,
    WORKFLOW_REALTIME_REQUIRED_CODE
  )
}
