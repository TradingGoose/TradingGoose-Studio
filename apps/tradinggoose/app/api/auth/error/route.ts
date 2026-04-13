import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  AUTH_ERROR_MESSAGE_COOKIE_NAME,
  AUTH_ERROR_MESSAGE_QUERY_PARAM,
} from '@/lib/auth/auth-error-copy'

export const dynamic = 'force-dynamic'

const AUTH_ERROR_COOKIE_PATH = '/api/auth/error'

async function buildErrorRedirectResponse(request: NextRequest) {
  const url = request.nextUrl.clone()
  const cookieStore = await cookies()
  const errorMessage = cookieStore.get(AUTH_ERROR_MESSAGE_COOKIE_NAME)?.value

  url.pathname = '/error'
  if (errorMessage && !url.searchParams.has(AUTH_ERROR_MESSAGE_QUERY_PARAM)) {
    url.searchParams.set(AUTH_ERROR_MESSAGE_QUERY_PARAM, errorMessage)
  }

  const response = NextResponse.redirect(url)
  response.cookies.set(AUTH_ERROR_MESSAGE_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: AUTH_ERROR_COOKIE_PATH,
    sameSite: 'lax',
  })
  return response
}

export async function GET(request: NextRequest) {
  return buildErrorRedirectResponse(request)
}

export async function HEAD(request: NextRequest) {
  return buildErrorRedirectResponse(request)
}
