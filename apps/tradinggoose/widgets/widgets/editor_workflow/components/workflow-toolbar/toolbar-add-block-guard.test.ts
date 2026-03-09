import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('phase 1 add-block event guard', () => {
  it('removes add-block-from-toolbar token from required files', () => {
    const files = [
      'widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas.tsx',
      'widgets/widgets/editor_workflow/components/toolbar/toolbar-block/toolbar-block.tsx',
      'widgets/widgets/editor_workflow/components/toolbar/toolbar-loop-block/toolbar-loop-block.tsx',
      'widgets/widgets/editor_workflow/components/toolbar/toolbar-parallel-block/toolbar-parallel-block.tsx',
      'widgets/widgets/editor_workflow/components/workflow-toolbar/workflow-toolbar.tsx',
    ]

    for (const file of files) {
      const content = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(content).not.toContain('add-block-from-toolbar')
    }
  })
})
