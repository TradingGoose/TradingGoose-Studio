import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const CONTENT_DIR = path.join(process.cwd(), 'app/(landing)/blog/content')

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path

  // Validate: must be exactly [slug, filename] — no traversal
  if (
    segments.length !== 2 ||
    segments.some((s) => s.includes('..') || s.includes('/') || s.includes('\\'))
  ) {
    return new NextResponse(null, { status: 400 })
  }

  const [slug, filename] = segments
  const ext = path.extname(filename).toLowerCase()
  const contentType = MIME_TYPES[ext]

  if (!contentType) {
    return new NextResponse(null, { status: 400 })
  }

  const filePath = path.join(CONTENT_DIR, slug, filename)

  // Ensure resolved path stays within content dir
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(CONTENT_DIR))) {
    return new NextResponse(null, { status: 403 })
  }

  try {
    const buffer = await readFile(resolved)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
