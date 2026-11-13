import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getEmbeddingModelRegistry, getModelRegistry } from '@/lib/mastra/registry'

export async function GET(request: NextRequest) {
  const auth = await checkSessionOrInternalAuth(request)
  if (!auth.success) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (request.nextUrl.searchParams.get('type') === 'embedding')
    return NextResponse.json({ models: await getEmbeddingModelRegistry() })
  return NextResponse.json({ providers: await getModelRegistry() })
}
