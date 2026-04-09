import { NextRequest, NextResponse } from 'next/server'
import { ZodError, z } from 'zod'
import { addToWaitlist, getRegistrationMode } from '@/lib/registration/service'
import { REGISTRATION_DISABLED_MESSAGE } from '@/lib/registration/shared'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

const waitlistRequestSchema = z.object({
  email: z.string().trim().email(),
})

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const registrationMode = await getRegistrationMode()
    if (registrationMode === 'disabled') {
      return NextResponse.json(
        { error: REGISTRATION_DISABLED_MESSAGE },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        }
      )
    }

    const body = await request.json()
    const payload = waitlistRequestSchema.parse(body)
    const entry = await addToWaitlist(payload.email)

    return NextResponse.json(
      {
        id: entry.id,
        email: entry.email,
        status: entry.status,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      }
    )
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid waitlist request', details: error.errors },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to join waitlist' },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    )
  }
}
