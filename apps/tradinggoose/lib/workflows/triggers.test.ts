import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

let listWorkflowRunTriggers: typeof import('./triggers').listWorkflowRunTriggers
let resolveWorkflowRunTrigger: typeof import('./triggers').resolveWorkflowRunTrigger

beforeAll(async () => {
  const triggers = await import('./triggers')
  listWorkflowRunTriggers = triggers.listWorkflowRunTriggers
  resolveWorkflowRunTrigger = triggers.resolveWorkflowRunTrigger
})

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
        github: block('github', { triggerMode: true }),
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
      ['github:github_webhook', 'GitHub Webhook'],
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
})
