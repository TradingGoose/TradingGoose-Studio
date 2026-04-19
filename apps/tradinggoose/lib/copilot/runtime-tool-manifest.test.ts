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
          description: expect.stringContaining('workflowSummary.blocks'),
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
          description: expect.stringContaining('input reference grammar'),
          kind: 'inspect',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'get_environment_variables',
          description: expect.stringContaining('{{ENV_VAR_NAME}}'),
          kind: 'read',
          entityKind: 'environment',
        }),
        expect.objectContaining({
          name: 'get_global_workflow_variables',
          description: expect.stringContaining('<variable.name>'),
          kind: 'read',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'get_block_outputs',
          description: expect.stringContaining('<agent.content>'),
          kind: 'inspect',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'get_block_upstream_references',
          description: expect.stringContaining('<variable.name>'),
          kind: 'inspect',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'get_indicator_catalog',
          description: expect.stringContaining('indicator authoring catalog'),
          kind: 'inspect',
          entityKind: 'indicator',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              query: expect.objectContaining({
                description: expect.stringContaining('capability search query'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'get_indicator_metadata',
          description: expect.stringContaining('exact section ids or item ids'),
          kind: 'inspect',
          entityKind: 'indicator',
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['targetIds']),
          }),
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
          name: 'edit_workflow_block',
          kind: 'edit',
          entityKind: 'workflow',
          description: expect.stringContaining('without changing workflow connections'),
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['workflowId', 'blockId']),
            properties: expect.objectContaining({
              subBlocks: expect.objectContaining({
                type: 'object',
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'create_workflow',
          kind: 'create',
          entityKind: 'workflow',
          description: expect.stringContaining('Use `edit_workflow` next'),
        }),
        expect.objectContaining({
          name: 'rename_workflow',
          kind: 'rename',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['workflowId', 'name']),
          }),
        }),
        expect.objectContaining({
          name: 'get_skill',
          description: expect.stringContaining('editable document payload'),
          kind: 'read',
          entityKind: 'skill',
        }),
        expect.objectContaining({
          name: 'create_skill',
          kind: 'create',
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
          name: 'rename_mcp_server',
          kind: 'rename',
          entityKind: 'mcp_server',
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
      ?.semanticValidators?.find((validator) => validator.kind === 'string_document_contract')
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
        edgeValidator?.args as
          | {
              contract?: { embeddedValidators?: Array<{ whenBlockType: string; path: string }> }
            }
          | undefined
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
    expect(toolNames).toContain('edit_workflow_block')
    expect(toolNames).toContain('create_workflow')
    expect(toolNames).toContain('get_indicator_catalog')
    expect(toolNames).toContain('get_indicator_metadata')
    expect(toolNames).toContain('rename_skill')
  })
})
