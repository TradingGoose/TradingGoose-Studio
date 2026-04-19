import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MONACO_VS_ROOT = path.join(process.cwd(), 'node_modules', 'monaco-editor', 'esm', 'vs')
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.js.map': 'application/json; charset=utf-8',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetPath: string[] }> }
) {
  const segments = (await params).assetPath

  if (
    segments.length === 0 ||
    segments.some((segment) => segment.includes('..') || segment.includes('\\'))
  ) {
    return new NextResponse(null, { status: 400 })
  }

  const relativePath = path.join(...segments)
  const contentType = relativePath.endsWith('.js.map')
    ? CONTENT_TYPES['.js.map']
    : CONTENT_TYPES[path.extname(relativePath).toLowerCase()]

  if (!contentType) {
    return new NextResponse(null, { status: 400 })
  }

  const assetPath = path.resolve(MONACO_VS_ROOT, relativePath)
  if (!assetPath.startsWith(path.resolve(MONACO_VS_ROOT))) {
    return new NextResponse(null, { status: 403 })
  }

  try {
    const file = await readFile(assetPath)
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': relativePath.endsWith('.js.map') ? 'no-store' : 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
