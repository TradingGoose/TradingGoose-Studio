import { describe, expect, it } from 'vitest'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'

describe('copilot runtime tool manifest', () => {
  it('exposes the Studio tool surface and workflow document instructions', () => {
    const manifest = getCopilotRuntimeToolManifest()
    const toolNames = manifest.tools.map((tool) => tool.name)

    expect(manifest.version).toBe('v1')
    expect(manifest.instructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('You are TradingGoose Copilot'),
        expect.stringContaining('Workflows are edited as full document updates'),
        expect.stringContaining('Monitors are edited as full document updates'),
        expect.stringContaining('Keep TradingGoose surfaces distinct'),
      ])
    )
    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'get_user_workflow',
          injectWorkflowId: true,
        }),
        expect.objectContaining({
          name: 'edit_workflow',
          kind: 'edit',
          entityKind: 'workflow',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_user_workflow'],
          requiredToolResults: ['get_user_workflow'],
          parameters: expect.objectContaining({
            type: 'object',
          }),
          instructions: expect.arrayContaining([
            expect.stringContaining('full document'),
          ]),
        }),
        expect.objectContaining({
          name: 'get_skill',
          description: expect.stringContaining('editable document payload'),
          kind: 'read',
          entityKind: 'skill',
          discoveryToolNames: ['list_skills'],
        }),
        expect.objectContaining({
          name: 'edit_custom_tool',
          kind: 'edit',
          entityKind: 'custom_tool',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_custom_tool'],
          requiredToolResults: ['get_custom_tool'],
          rules: expect.stringContaining('full edited custom tool document'),
        }),
        expect.objectContaining({
          name: 'edit_monitor',
          kind: 'edit',
          entityKind: 'monitor',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_monitor'],
          requiredToolResults: ['get_monitor'],
          rules: expect.stringContaining('full edited monitor document'),
        }),
      ])
    )
  })
})
