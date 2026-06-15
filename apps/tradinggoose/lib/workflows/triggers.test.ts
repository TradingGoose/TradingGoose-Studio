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

describe('workflow run trigger resolution', () => {
  it('lists one Run option per resolved trigger identity', () => {
    const runTriggers = listWorkflowRunTriggers({
      github: block('github', { triggerMode: true }),
      whatsapp: block('whatsapp', { triggerMode: true }),
      calendly: block('calendly', {
        triggerMode: true,
        subBlocks: { selectedTriggerId: { value: 'calendly_invitee_created' } },
      }),
      unconfiguredCalendly: block('calendly', { triggerMode: true }),
      agent: block('agent'),
    })

    expect(runTriggers.map(({ id, name }) => [id, name])).toEqual([
      ['github:github_webhook', 'GitHub Webhook'],
      ['whatsapp:whatsapp_webhook', 'WhatsApp Webhook'],
      ['calendly:calendly_invitee_created', 'Calendly Invitee Created'],
    ])
    expect(new Set(runTriggers.map((trigger) => trigger.id)).size).toBe(runTriggers.length)
    expect(runTriggers.every((trigger) => trigger.icon && trigger.color)).toBe(true)
  })

  it('materializes the resolved trigger source for execution', () => {
    const run = resolveWorkflowRunTrigger(
      { github: block('github', { triggerMode: true }) },
      { surface: 'editor', triggerBlockId: 'github' }
    )

    expect(run.triggerType).toBe('manual')
    expect((run.blocks.github.subBlocks as Record<string, unknown>).selectedTriggerId).toEqual({
      value: 'github_webhook',
    })
  })

  it('generates editor test input while preserving explicit copilot input', () => {
    const editorRun = resolveWorkflowRunTrigger(
      { indicator: block('indicator_trigger') },
      { surface: 'editor', triggerBlockId: 'indicator' }
    )

    expect(editorRun.input).toMatchObject({
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
      signal: 'mock_signal',
    })

    const explicitInput = { listing: { listing_id: 'MSFT' }, signal: 'buy' }
    expect(
      resolveWorkflowRunTrigger(
        { indicator: block('indicator_trigger') },
        { surface: 'copilot', triggerBlockId: 'indicator', workflowInput: explicitInput }
      ).input
    ).toBe(explicitInput)
  })
})
