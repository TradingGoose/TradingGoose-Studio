import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PREVIEW_RUNTIME_FILES = [
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-workflow.tsx',
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-node.tsx',
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-subflow.tsx',
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/read-only-node-editor-panel.tsx',
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-panel-registry.ts',
  'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-payload-adapter.ts',
]

const BANNED_IMPORT_PATTERNS = [
  'hooks/use-collaborative-workflow',
  'stores/workflows/workflow/store-client',
  'stores/workflows/workflow/store',
  'stores/workflows/subblock/store',
  'stores/operation-queue/store',
  'contexts/socket-context',
]

const BANNED_MUTATION_PATTERNS = [
  'collaborative',
  'setStateForChannel',
  '.updateBlock',
  '.removeBlock',
  '.toggleBlock',
  '.addEdge',
  '.removeEdge',
  '.setValue(',
]

describe('preview read-only guards', () => {
  it('does not allow preview runtime modules to depend on mutation paths', () => {
    const rootDir = process.cwd()
    const violations: string[] = []

    PREVIEW_RUNTIME_FILES.forEach((relativePath) => {
      const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
      const importLines = content
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import '))

      BANNED_IMPORT_PATTERNS.forEach((pattern) => {
        if (importLines.some((line) => line.includes(pattern))) {
          violations.push(`${relativePath} -> import:${pattern}`)
        }
      })

      BANNED_MUTATION_PATTERNS.forEach((pattern) => {
        if (content.includes(pattern)) {
          violations.push(`${relativePath} -> usage:${pattern}`)
        }
      })
    })

    expect(violations).toEqual([])
  })

  it('enforces explicit readOnly=true when rendering preview panel components', () => {
    const rootDir = process.cwd()
    const relativePath =
      'widgets/widgets/editor_workflow/components/workflow-editor/preview/read-only-node-editor-panel.tsx'
    const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8')

    expect(content.includes('readOnly={true}')).toBe(true)
    expect(content.includes('readOnly={false}')).toBe(false)
    expect(content.includes('readOnly={readOnly}')).toBe(false)
  })

  it('keeps preview panel prop contract read-only only', () => {
    const rootDir = process.cwd()
    const relativePath =
      'widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-panel-registry.ts'
    const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8')

    expect(content.includes('readOnly?: true')).toBe(true)
    expect(content.includes('readOnly?: boolean')).toBe(false)
  })
})
