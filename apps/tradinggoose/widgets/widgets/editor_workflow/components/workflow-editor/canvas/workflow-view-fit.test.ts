import { describe, expect, it } from 'vitest'
import {
  shouldAutoFitWorkflowView,
  WORKFLOW_FIT_VIEW_PADDING,
} from './workflow-view-fit'

describe('shouldAutoFitWorkflowView', () => {
  it('fits when switching to a different workflow identity that already has nodes', () => {
    expect(
      shouldAutoFitWorkflowView({
        previousIdentity: 'pair-red:wf-1',
        nextIdentity: 'pair-blue:wf-2',
        previousNodeCount: 4,
        nextNodeCount: 3,
        isWorkflowReady: true,
      })
    ).toBe(true)
  })

  it('fits when nodes appear for the current workflow after initial empty render', () => {
    expect(
      shouldAutoFitWorkflowView({
        previousIdentity: 'pair-red:wf-1',
        nextIdentity: 'pair-red:wf-1',
        previousNodeCount: 0,
        nextNodeCount: 2,
        isWorkflowReady: true,
      })
    ).toBe(true)
  })

  it('does not fit while the workflow is not ready', () => {
    expect(
      shouldAutoFitWorkflowView({
        previousIdentity: 'pair-red:wf-1',
        nextIdentity: 'pair-blue:wf-2',
        previousNodeCount: 3,
        nextNodeCount: 5,
        isWorkflowReady: false,
      })
    ).toBe(false)
  })

  it('exports the shared fit padding used by the editor canvas', () => {
    expect(WORKFLOW_FIT_VIEW_PADDING).toBe(0.3)
  })
})
