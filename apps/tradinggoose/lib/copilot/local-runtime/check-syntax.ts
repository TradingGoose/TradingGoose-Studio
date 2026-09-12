// Parser-only syntax gate for the local Copilot runtime and its patched routes.
//
// `next build` runs under Turbopack with TS errors ignored (DOCKER_BUILD=1), so a
// syntax error - an unescaped backtick inside a template literal, say - would only
// surface after the full image build. Bun.Transpiler parses without resolving
// imports, so this catches that class of error in milliseconds.
//
// Usage: bun check-syntax.ts <app-dir>
// Exits non-zero and prints the offending files on failure.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const appDir = process.argv[2]
if (!appDir) {
  console.error('usage: bun check-syntax.ts <app-dir>')
  process.exit(2)
}

const RUNTIME_DIR = 'lib/copilot/local-runtime'
const PATCHED_FILES = [
  'lib/copilot/runtime-models.ts',
  'lib/copilot/agent/utils.ts',
  'app/api/copilot/chat/route.ts',
  'app/api/copilot/usage/route.ts',
  'app/api/copilot/tools/mark-complete/route.ts',
]

function listTs(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listTs(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

const targets = [...listTs(join(appDir, RUNTIME_DIR)), ...PATCHED_FILES.map((f) => join(appDir, f))]

const transpiler = new Bun.Transpiler({ loader: 'ts' })
let failed = 0

for (const file of targets) {
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    console.error(`MISSING ${file}`)
    failed++
    continue
  }
  try {
    transpiler.transformSync(source)
    console.log(`ok   ${file.slice(appDir.length + 1)}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${file.slice(appDir.length + 1)}`)
    console.error(
      String((error as Error).message)
        .split('\n')
        .slice(0, 14)
        .join('\n')
    )
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed to parse`)
  process.exit(1)
}
console.log(`\nall ${targets.length} files parse cleanly`)
