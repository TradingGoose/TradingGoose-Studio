import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const BANNED_IMPORT_PATTERNS = [
  'workflow-block/workflow-block',
  'components/sub-block/sub-block',
  'workflow-editor/panel/',
]

const PREVIEW_DIR =
  'widgets/widgets/editor_workflow/components/workflow-editor/preview'

const CUTOVER_SURFACE_FILES = [
  'app/workspace/[workspaceId]/components/workflow-preview/workflow-preview.tsx',
  'widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-card.tsx',
  'widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-modal.tsx',
]

function listPreviewSurfaceFiles(rootDir: string): string[] {
  const previewRoot = path.join(rootDir, PREVIEW_DIR)
  const pending: string[] = [previewRoot]
  const files: string[] = []

  while (pending.length > 0) {
    const current = pending.pop()!
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      if (absolutePath.endsWith('.ts') || absolutePath.endsWith('.tsx')) {
        files.push(path.relative(rootDir, absolutePath))
      }
    }
  }

  return files
}

describe('preview cutover import guard', () => {
  it('does not allow legacy workflow-block/sub-block or editor-panel imports across preview surfaces', () => {
    const rootDir = process.cwd()
    const filesToCheck = [...CUTOVER_SURFACE_FILES, ...listPreviewSurfaceFiles(rootDir)]

    const violations: string[] = []

    filesToCheck.forEach((relativePath) => {
      const absolutePath = path.join(rootDir, relativePath)
      const content = fs.readFileSync(absolutePath, 'utf8')
      const importLines = content
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import '))

      BANNED_IMPORT_PATTERNS.forEach((bannedPattern) => {
        if (importLines.some((line) => line.includes(bannedPattern))) {
          violations.push(`${relativePath} -> ${bannedPattern}`)
        }
      })
    })

    expect(violations).toEqual([])
  })
})
