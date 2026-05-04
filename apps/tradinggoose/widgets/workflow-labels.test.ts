import { describe, expect, it } from 'vitest'
import { translateWorkflowLabel } from './workflow-labels'

describe('translateWorkflowLabel', () => {
  it('translates tools labels and strips trailing colons before lookup', () => {
    expect(translateWorkflowLabel('zh-CN', 'Tools')).toBe('工具')
    expect(translateWorkflowLabel('zh-CN', 'Response Format:')).toBe('响应格式')
  })
})
