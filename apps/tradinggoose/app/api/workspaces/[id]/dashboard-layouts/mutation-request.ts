import { type NextRequest, NextResponse } from 'next/server'

export function validateDashboardMutationRequest(request: NextRequest) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 })
  }

  const origin = request.headers.get('origin')
  if (origin === null) return null

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  const host = forwardedHost || request.headers.get('host')?.trim()
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  return !host || originHost.toLowerCase() !== host.toLowerCase()
    ? NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    : null
}
