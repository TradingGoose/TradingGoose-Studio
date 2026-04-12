import { NextResponse } from 'next/server'
import { getRegistrationModeForRender } from '@/lib/registration/service'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const registrationMode = await getRegistrationModeForRender()

  return NextResponse.json(
    { registrationMode },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    }
  )
}
