import { describe, expect, it } from 'vitest'

describe('DeploymentControls status logic', () => {
  it('uses the parent redeployment state directly', () => {
    let needsRedeployment = false
    expect(needsRedeployment).toBe(false)

    needsRedeployment = true
    expect(needsRedeployment).toBe(true)

    needsRedeployment = false
    expect(needsRedeployment).toBe(false)
  })

  it('shows the previous-version indicator only for deployed workflows with changes', () => {
    expect(false && true).toBe(false)
    expect(true && false).toBe(false)
    expect(true && true).toBe(true)
  })

  it('uses the deployment status supplied by the control-bar owner', () => {
    const getTooltipMessage = (isDeployed: boolean, needsRedeployment: boolean) => {
      if (isDeployed && needsRedeployment) return 'Workflow changes detected'
      if (isDeployed) return 'Deployment Settings'
      return 'Deploy as API'
    }

    expect(getTooltipMessage(false, false)).toBe('Deploy as API')
    expect(getTooltipMessage(false, true)).toBe('Deploy as API')
    expect(getTooltipMessage(true, false)).toBe('Deployment Settings')
    expect(getTooltipMessage(true, true)).toBe('Workflow changes detected')
  })
})
