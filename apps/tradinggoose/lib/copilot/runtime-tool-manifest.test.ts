import { describe, expect, it } from 'vitest'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { WORKFLOW_DOCUMENT_CONTRACT } from '@/lib/copilot/runtime-tool-manifest-enrichment'

describe('copilot runtime tool manifest', () => {
  it('exposes the Studio tool surface and workflow document instructions', async () => {
    const manifest = await getCopilotRuntimeToolManifest()
    const toolNames = manifest.tools.map((tool) => tool.name)
    const joinedInstructions = manifest.instructions?.join(' ') ?? ''

    expect(manifest.version).toBe('v1')
    expect(manifest.instructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('You are TradingGoose Copilot'),
        expect.stringContaining('Workflows are edited as full document updates'),
        expect.stringContaining('TG_EDGE'),
        expect.stringContaining('child blocks inside the container subgraph'),
        expect.stringContaining('Condition blocks are not rendered like normal blocks'),
        expect.stringContaining('Monitors are edited as full document updates'),
        expect.stringContaining('Keep TradingGoose surfaces distinct'),
        expect.stringContaining('Do not use `current_*` context as a tool target'),
      ])
    )
    expect(joinedInstructions).not.toContain('user accepts')
    expect(joinedInstructions).not.toContain('confirmation')
    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'get_user_workflow',
          description: expect.stringContaining('entityDocument'),
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['workflowId']),
          }),
        }),
        expect.objectContaining({
          name: 'edit_workflow',
          kind: 'edit',
          entityKind: 'workflow',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_user_workflow'],
          requiredToolResults: expect.arrayContaining([
            'get_user_workflow',
            'get_workflow_from_name',
          ]),
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'workflowDocument',
              kind: 'string_requires_real_newlines',
            }),
            expect.objectContaining({
              path: 'workflowDocument',
              kind: 'string_document_contract',
            }),
            expect.objectContaining({
              path: 'workflowDocument',
              kind: 'string_line_prefix_json_schema',
              args: expect.any(Object),
            }),
          ]),
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
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['entityId']),
          }),
        }),
        expect.objectContaining({
          name: 'edit_skill',
          kind: 'edit',
          entityKind: 'skill',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_skill'],
          requiredToolResults: ['get_skill'],
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'entityDocument',
              kind: 'string_json_schema',
              args: expect.any(Object),
            }),
          ]),
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
          surfaceKind: 'monitor',
          mutatesState: true,
          requiresCurrentState: true,
          verificationToolNames: ['get_monitor'],
          requiredToolResults: ['get_monitor'],
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'monitorDocument',
              kind: 'string_json_schema',
              args: expect.any(Object),
            }),
          ]),
          rules: expect.stringContaining('full edited monitor document'),
        }),
      ])
    )
    expect(manifest.tools.find((tool) => tool.name === 'edit_workflow')?.rules).not.toContain(
      'accept'
    )
    const edgeValidator = manifest.tools
      .find((tool) => tool.name === 'edit_workflow')
      ?.semanticValidators?.find(
        (validator) => validator.kind === 'string_document_contract'
      )
    expect(edgeValidator).toBeDefined()
    expect(edgeValidator?.description).toBe(
      'Keep visible edges and canonical `TG_EDGE` state aligned.'
    )
    expect(edgeValidator?.args).toEqual(
      expect.objectContaining({
        contract: expect.objectContaining(WORKFLOW_DOCUMENT_CONTRACT),
      })
    )
    expect(
      (
        edgeValidator?.args as {
          contract?: { embeddedValidators?: Array<{ whenBlockType: string; path: string }> }
        } | undefined
      )?.contract?.embeddedValidators
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          whenBlockType: 'agent',
          path: 'subBlocks.responseFormat.value',
        }),
        expect.objectContaining({
          whenBlockType: 'function',
          path: 'subBlocks.code.value',
        }),
        expect.objectContaining({
          whenBlockType: 'condition',
          path: 'subBlocks.conditions.value',
        }),
      ])
    )
    expect(
      manifest.tools
        .find((tool) => tool.name === 'edit_workflow')
        ?.semanticValidators?.some(
          (validator) => validator.kind === 'string_requires_line_prefix_if_substring_present'
        )
    ).toBe(false)
    expect(manifest.tools.find((tool) => tool.name === 'edit_monitor')?.description).not.toContain(
      'confirmation'
    )
  })
})
