import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { resolveOutputType } from '@/blocks/utils'
import { getTrigger } from '@/triggers'
import { PortfolioStateTriggerBlock } from '@/triggers/blocks/portfolio_state_trigger'
import { portfolioStateTrigger } from '@/triggers/portfolio/trigger'
import { getBlockOutputPaths, getBlockOutputType, readBlockOutputs } from './block-outputs'
import { listWorkflowRunTriggers, resolveWorkflowRunTrigger } from './triggers'

const block = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  enabled: true,
  subBlocks: {},
  ...extra,
})
const edge = (source: string, target = 'agent') => ({ source, target })

describe('workflow run trigger resolution', () => {
  it('lists one Run option per resolved trigger identity', () => {
    const edges = ['github', 'whatsapp', 'calendly', 'chat'].map((source) => edge(source))
    const runTriggers = listWorkflowRunTriggers(
      {
        github: block('github', { name: 'Production GitHub', triggerMode: true }),
        whatsapp: block('whatsapp', { triggerMode: true }),
        calendly: block('calendly', {
          triggerMode: true,
          subBlocks: { selectedTriggerId: { value: 'calendly_invitee_created' } },
        }),
        disconnectedGithub: block('github', { triggerMode: true }),
        chat: block('chat_trigger'),
      },
      edges
    )

    expect(runTriggers.map(({ id, name }) => [id, name])).toEqual([
      ['github:github_webhook', 'Production GitHub'],
      ['whatsapp:whatsapp_webhook', 'WhatsApp Webhook'],
      ['calendly:calendly_invitee_created', 'Calendly Invitee Created'],
    ])
    expect(runTriggers.every((trigger) => trigger.icon && trigger.color)).toBe(true)
  })

  it('generates editor test input while preserving explicit copilot input', () => {
    const editorRun = resolveWorkflowRunTrigger(
      { indicator: block('indicator_trigger') },
      [edge('indicator')],
      { surface: 'editor', triggerBlockId: 'indicator' }
    )

    expect(editorRun.input).toMatchObject({
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
      signal: 'mock_signal',
    })
    expect(
      (editorRun.blocks.indicator.subBlocks as Record<string, unknown>).selectedTriggerId
    ).toEqual({
      value: 'indicator_trigger',
    })

    const explicitInput = { listing: { listing_id: 'MSFT' }, signal: 'buy' }
    expect(
      resolveWorkflowRunTrigger({ indicator: block('indicator_trigger') }, [edge('indicator')], {
        surface: 'copilot',
        triggerBlockId: 'indicator',
        workflowInput: explicitInput,
      }).input
    ).toBe(explicitInput)
  })

  it.each([false, true])(
    'exposes canonical portfolio objects and nested paths with triggerMode=%s',
    (triggerMode) => {
      expect(getBlockOutputPaths('portfolio_state_trigger', {}, triggerMode)).toEqual([
        'input',
        'event',
        'portfolio',
        'portfolio.identity',
        'portfolio.detail',
        'monitor',
        'monitor.id',
        'monitor.workflowId',
        'monitor.blockId',
        'monitor.providerId',
        'monitor.serviceId',
        'monitor.accountId',
        'condition',
      ])
      for (const path of ['portfolio', 'portfolio.identity', 'portfolio.detail', 'monitor']) {
        expect(getBlockOutputType('portfolio_state_trigger', path, {}, triggerMode)).toBe('object')
      }
      expect(
        getBlockOutputType('portfolio_state_trigger', 'monitor.workflowId', {}, triggerMode)
      ).toBe('string')
    }
  )

  it('shares typed portfolio output definitions and preserves nested runtime outputs', () => {
    expect(PortfolioStateTriggerBlock.outputs).toBe(portfolioStateTrigger.outputs)
    expect(portfolioStateTrigger.outputs.portfolio).toEqual({
      type: 'object',
      description: 'Monitored portfolio identity and the detail snapshot that matched.',
      properties: {
        identity: { type: 'object', description: 'Trading portfolio identity.' },
        detail: { type: 'object', description: 'Portfolio detail snapshot.' },
      },
    })
    expect(resolveOutputType(readBlockOutputs('portfolio_state_trigger', {}, true))).toEqual({
      input: 'string',
      event: 'string',
      portfolio: { identity: 'object', detail: 'object' },
      monitor: {
        id: 'string',
        workflowId: 'string',
        blockId: 'string',
        providerId: 'string',
        serviceId: 'string',
        accountId: 'string',
      },
      condition: 'json',
    })
  })

  it('preserves nested portfolio fields in editor test input and displayed event examples', () => {
    const editorRun = resolveWorkflowRunTrigger(
      { portfolio: block('portfolio_state_trigger') },
      [edge('portfolio')],
      { surface: 'editor', triggerBlockId: 'portfolio' }
    )
    const mockObject = { id: 'sample_id', name: 'Sample Object', status: 'active' }
    expect(editorRun.input).toEqual({
      input: 'mock_input',
      event: 'mock_event',
      portfolio: { identity: mockObject, detail: mockObject },
      monitor: {
        id: 'mock_id',
        workflowId: 'mock_workflowId',
        blockId: 'mock_blockId',
        providerId: 'mock_providerId',
        serviceId: 'mock_serviceId',
        accountId: 'mock_accountId',
      },
      condition: mockObject,
    })

    const samplePayload = getTrigger('portfolio_state_trigger')?.subBlocks.find(
      (subBlock) => subBlock.id === 'samplePayload'
    )?.defaultValue
    expect(typeof samplePayload).toBe('string')
    expect(JSON.parse(samplePayload as string)).toEqual(editorRun.input)
  })

  it('surfaces selected trigger configuration errors', () => {
    expect(() =>
      resolveWorkflowRunTrigger(
        { calendly: block('calendly', { name: 'Calendly Lead Capture', triggerMode: true }) },
        [edge('calendly')],
        { surface: 'editor', triggerBlockId: 'calendly' }
      )
    ).toThrow('Calendly Lead Capture requires a selected trigger type')
  })
})
