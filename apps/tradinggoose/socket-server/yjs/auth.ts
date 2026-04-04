import { auth } from '@/lib/auth'
import { parseYjsTransportEnvelope } from '@/lib/copilot/review-sessions/identity'
import type { YjsTransportEnvelope } from '@/lib/copilot/review-sessions/types'

export interface YjsAuthResult {
  userId: string
  userName: string | null
  envelope: YjsTransportEnvelope
}

export async function authenticateYjsConnection(url: URL): Promise<YjsAuthResult> {
  const token = url.searchParams.get('token')
  if (!token) {
    throw new YjsAuthError(401, 'Missing authentication token')
  }

  const params: Record<string, string | undefined> = {}
  url.searchParams.forEach((value, key) => {
    if (key !== 'token') {
      params[key] = value
    }
  })

  let envelope: YjsTransportEnvelope
  try {
    envelope = parseYjsTransportEnvelope(params)
  } catch (error) {
    throw new YjsAuthError(
      409,
      error instanceof Error ? error.message : 'Invalid Yjs transport envelope'
    )
  }

  let session: Awaited<ReturnType<typeof auth.api.verifyOneTimeToken>>
  try {
    session = await auth.api.verifyOneTimeToken({ body: { token } })
  } catch (error) {
    if (isInvalidOneTimeTokenError(error)) {
      throw new YjsAuthError(401, 'Invalid or expired token')
    }

    throw error
  }

  if (!session?.user?.id) {
    throw new YjsAuthError(401, 'Invalid or expired token')
  }

  return {
    userId: session.user.id,
    userName: session.user.name || session.user.email || null,
    envelope,
  }
}

export class YjsAuthError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
    this.name = 'YjsAuthError'
  }
}

function isInvalidOneTimeTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as {
    body?: { code?: unknown }
    statusCode?: unknown
  }

  return (
    candidate.body?.code === 'INVALID_TOKEN' &&
    (candidate.statusCode === 400 || candidate.statusCode === 401)
  )
}
