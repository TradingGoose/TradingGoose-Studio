import { describe, expect, it } from 'vitest'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { WORKFLOW_DOCUMENT_CONTRACT } from '@/lib/copilot/runtime-tool-manifest-enrichment'

describe('copilot runtime tool manifest', () => {
  it('exposes the Studio tool surface and workflow document validators', async () => {
    const manifest = await getCopilotRuntimeToolManifest()
    const toolNames = manifest.tools.map((tool) => tool.name)

    expect(manifest.version).toBe('v1')
    expect(manifest).not.toHaveProperty('instructions')
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
          name: 'get_blocks_and_tools',
          description: expect.stringContaining('canonical workflow block catalog'),
          kind: 'inspect',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              query: expect.objectContaining({
                description: expect.stringContaining('capability search query'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'get_blocks_metadata',
          description: expect.stringContaining('canonical profiles'),
          kind: 'inspect',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'edit_workflow',
          kind: 'edit',
          entityKind: 'workflow',
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
        }),
        expect.objectContaining({
          name: 'get_skill',
          description: expect.stringContaining('editable document payload'),
          kind: 'read',
          entityKind: 'skill',
        }),
        expect.objectContaining({
          name: 'edit_skill',
          kind: 'edit',
          entityKind: 'skill',
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
        }),
        expect.objectContaining({
          name: 'edit_monitor',
          kind: 'edit',
          surfaceKind: 'monitor',
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'monitorDocument',
              kind: 'string_json_schema',
              args: expect.any(Object),
            }),
          ]),
        }),
      ])
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
    expect(toolNames).toContain('edit_workflow')
  })
})
