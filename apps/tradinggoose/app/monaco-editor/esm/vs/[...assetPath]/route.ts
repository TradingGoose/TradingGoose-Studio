import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const PROJECT_ROOT = /* turbopackIgnore: true */ process.cwd()
const MONACO_PACKAGE_ROOTS = [
  path.resolve(PROJECT_ROOT, 'node_modules', 'monaco-editor'),
  path.resolve(PROJECT_ROOT, 'apps', 'tradinggoose', 'node_modules', 'monaco-editor'),
]
const MONACO_BUN_INSTALL_ROOTS = [
  path.resolve(PROJECT_ROOT, 'node_modules', '.bun'),
  path.resolve(PROJECT_ROOT, 'apps', 'tradinggoose', 'node_modules', '.bun'),
]
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.js.map': 'application/json; charset=utf-8',
}
let monacoVsRootsPromise: Promise<string[]> | undefined

async function getMonacoVsRoots() {
  if (monacoVsRootsPromise) {
    return monacoVsRootsPromise
  }

  monacoVsRootsPromise = (async () => {
    const roots = new Set(MONACO_PACKAGE_ROOTS.map((root) => path.resolve(root, 'esm', 'vs')))

    for (const bunInstallRoot of MONACO_BUN_INSTALL_ROOTS) {
      try {
        const entries = await readdir(bunInstallRoot, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || !entry.name.startsWith('monaco-editor@')) {
            continue
          }

          roots.add(
            path.resolve(bunInstallRoot, entry.name, 'node_modules', 'monaco-editor', 'esm', 'vs')
          )
        }
      } catch {}
    }

    return [...roots]
  })()

  return monacoVsRootsPromise
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

  for (const monacoVsRoot of await getMonacoVsRoots()) {
    const assetPath = path.resolve(monacoVsRoot, relativePath)
    if (!assetPath.startsWith(monacoVsRoot)) {
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
    } catch {}
  }

  return new NextResponse(null, { status: 404 })
}
