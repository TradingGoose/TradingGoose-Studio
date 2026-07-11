import { describe, expect, it } from 'vitest'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'

describe('copilot runtime tool manifest', () => {
  it('exposes the Studio tool surface and workflow document validators', async () => {
    const manifest = await getCopilotRuntimeToolManifest()
    const toolNames = manifest.tools.map((tool) => tool.name)

    expect(manifest.version).toBe('v2')
    expect(manifest).not.toHaveProperty('instructions')
    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read_workflow',
          description: expect.stringContaining('connections` counts'),
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['entityId']),
          }),
        }),
        expect.objectContaining({
          name: 'get_available_blocks',
          description: expect.stringContaining('canonical workflow block catalog'),
          kind: 'inspect',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              query: expect.objectContaining({
                description: expect.stringContaining('capability search query'),
              }),
              category: expect.objectContaining({
                enum: ['block', 'tool', 'trigger'],
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'get_blocks_metadata',
          description: expect.stringContaining('input reference grammar'),
          kind: 'inspect',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['blockTypes']),
            properties: expect.objectContaining({
              blockTypes: expect.objectContaining({
                description: expect.stringContaining('Canonical workflow block type ids'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'get_agent_accessory_catalog',
          description: expect.stringContaining('Agent block accessories'),
          kind: 'inspect',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'read_environment_variables',
          description: expect.stringContaining('{{ENV_VAR_NAME}}'),
          kind: 'read',
          entityKind: 'environment',
        }),
        expect.objectContaining({
          name: 'edit_workflow_variable',
          description: expect.stringContaining('workflow-variable document'),
          kind: 'edit',
          entityKind: 'workflow',
        }),
        expect.objectContaining({
          name: 'read_block_outputs',
          description: expect.stringContaining('outputs[].path'),
          kind: 'inspect',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              blockIds: expect.objectContaining({
                description: expect.stringContaining('workflowSummary.blocks'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'read_block_upstream_references',
          description: expect.stringContaining('accessibleBlocks.outputs[].path'),
          kind: 'inspect',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              blockIds: expect.objectContaining({
                description: expect.stringContaining('workflowSummary.blocks'),
              }),
            }),
          }),
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
          name: 'list_indicators',
          description: expect.stringContaining(
            'built-in default indicators and workspace custom indicators'
          ),
          kind: 'list',
          entityKind: 'indicator',
        }),
        expect.objectContaining({
          name: 'read_indicator',
          description: expect.stringContaining('Pass `runtimeId` from `list_indicators`'),
          kind: 'read',
          entityKind: 'indicator',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              runtimeId: expect.objectContaining({
                description: expect.stringContaining('Indicator runtime id'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'edit_indicator',
          description: expect.stringContaining('Built-in default indicators are not editable'),
          kind: 'edit',
          entityKind: 'indicator',
        }),
        expect.objectContaining({
          name: 'edit_workflow',
          description: expect.stringContaining('minimal Mermaid `entityDocument`'),
          kind: 'edit',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            type: 'object',
            required: expect.arrayContaining(['entityId', 'entityDocument']),
            properties: expect.objectContaining({
              entityId: expect.any(Object),
              entityDocument: expect.objectContaining({
                description: expect.stringContaining('Minimal Mermaid flowchart'),
              }),
              removedBlockIds: expect.objectContaining({
                description: expect.stringContaining('intentionally removed'),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'edit_workflow_block',
          description: expect.stringContaining('Default tool for one existing block config change'),
          kind: 'edit',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['entityId', 'blockId']),
            properties: expect.objectContaining({
              subBlocks: expect.objectContaining({
                description: expect.stringContaining('Partial patch for the selected block only'),
                type: 'object',
              }),
            }),
          }),
        }),
        expect.objectContaining({
          name: 'create_workflow',
          kind: 'create',
          entityKind: 'workflow',
          description: expect.stringContaining('with `edit_workflow` next'),
        }),
        expect.objectContaining({
          name: 'rename_workflow',
          kind: 'rename',
          entityKind: 'workflow',
          parameters: expect.objectContaining({
            required: expect.arrayContaining(['entityId', 'name']),
          }),
        }),
        expect.objectContaining({
          name: 'read_skill',
          description: expect.stringContaining('editable document payload'),
          kind: 'read',
          entityKind: 'skill',
        }),
        expect.objectContaining({
          name: 'create_skill',
          description: expect.stringContaining('separate `name` identity'),
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
          name: 'create_custom_tool',
          description: expect.stringContaining('schemaText'),
          kind: 'create',
          entityKind: 'custom_tool',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              entityDocument: expect.objectContaining({
                description: expect.stringContaining('JSON-encoded string'),
              }),
            }),
          }),
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
          description: expect.stringContaining('schemaText'),
          kind: 'edit',
          entityKind: 'custom_tool',
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'entityDocument',
              kind: 'string_json_schema',
            }),
          ]),
        }),
        expect.objectContaining({
          name: 'rename_mcp_server',
          kind: 'rename',
          entityKind: 'mcp_server',
        }),
        expect.objectContaining({
          name: 'edit_watchlist',
          kind: 'edit',
          entityKind: 'watchlist',
          semanticValidators: expect.arrayContaining([
            expect.objectContaining({
              path: 'entityDocument',
              kind: 'string_json_schema',
              args: expect.any(Object),
            }),
          ]),
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
    const editWorkflowValidators =
      manifest.tools.find((tool) => tool.name === 'edit_workflow')?.semanticValidators ?? []
    expect(editWorkflowValidators.map((validator) => validator.kind)).toEqual([
      'string_requires_real_newlines',
      'string_starts_with',
      'string_forbids_substring',
    ])
    const editWorkflowProperties =
      (manifest.tools.find((tool) => tool.name === 'edit_workflow')?.parameters?.properties as
        | Record<string, unknown>
        | undefined) ?? {}
    const createWorkflowProperties =
      (manifest.tools.find((tool) => tool.name === 'create_workflow')?.parameters?.properties as
        | Record<string, unknown>
        | undefined) ?? {}
    const createIndicatorSchema = manifest.tools
      .find((tool) => tool.name === 'create_indicator')
      ?.semanticValidators?.find((validator) => validator.kind === 'string_json_schema')?.args
      ?.schema as { properties?: Record<string, unknown>; required?: string[] } | undefined
    expect(createWorkflowProperties).not.toHaveProperty('color')
    expect(createIndicatorSchema?.properties ?? {}).toHaveProperty('color')
    expect(createIndicatorSchema?.required ?? []).toContain('color')
    expect(editWorkflowProperties).toHaveProperty('entityId')
    expect(editWorkflowProperties).toHaveProperty('entityDocument')
    expect(editWorkflowProperties).toHaveProperty('removedBlockIds')
    expect(editWorkflowProperties).not.toHaveProperty('documentFormat')
    expect(editWorkflowProperties).not.toHaveProperty('workflowId')
    expect(editWorkflowProperties).not.toHaveProperty('workflowDocument')
    expect(
      manifest.tools.find((tool) => tool.name === 'edit_workflow_block')?.description
    ).toContain('without changing workflow connections')
    expect(manifest.tools.find((tool) => tool.name === 'edit_monitor')?.description).not.toContain(
      'confirmation'
    )
    const editLayoutProperties =
      (manifest.tools.find((tool) => tool.name === 'edit_layout')?.parameters?.properties as
        | Record<string, any>
        | undefined) ?? {}
    expect(editLayoutProperties).toHaveProperty('removedPanelIds')
    expect(editLayoutProperties.documentFormat?.const).toBe('tg-dashboard-layout-structure-v2')
    const editLayoutSemanticValidator = manifest.tools
      .find((tool) => tool.name === 'edit_layout')
      ?.semanticValidators?.find((validator) => validator.kind === 'string_json_schema')
    const editLayoutSchema = editLayoutSemanticValidator?.args?.schema as
      | {
          properties?: Record<string, unknown>
          required?: string[]
        }
      | undefined
    const editLayoutSchemaText = JSON.stringify(editLayoutSchema)
    expect(editLayoutSemanticValidator?.message).toContain('tg-dashboard-layout-structure-v2')
    expect(editLayoutSchema?.required).toEqual(['layout'])
    expect(editLayoutSchema?.properties).not.toHaveProperty('colorPairs')
    expect(editLayoutSchemaText).not.toContain('pairColor')
    expect(editLayoutSchemaText).not.toContain('params')
    const editWidgetProperties =
      (manifest.tools.find((tool) => tool.name === 'edit_widget')?.parameters?.properties as
        | Record<string, unknown>
        | undefined) ?? {}
    expect(editWidgetProperties).not.toHaveProperty('widgetKey')
    expect(editWidgetProperties).toHaveProperty('panelId')
    expect(editWidgetProperties).toHaveProperty('params')
    expect(manifest.tools.find((tool) => tool.name === 'read_layout')?.description).toContain(
      'params` is persisted local state'
    )
    expect(manifest.tools.find((tool) => tool.name === 'edit_layout')?.description).toContain(
      'same complete layout document shape as `read_layout`'
    )
    expect(manifest.tools.find((tool) => tool.name === 'edit_widget')?.description).toContain(
      'same non-gray `pairColor`'
    )
    expect(manifest.tools.find((tool) => tool.name === 'create_layout')?.description).toContain(
      'first layout is active automatically; later layouts are inactive'
    )
    const mcpServerDescriptions = ['read_mcp_server', 'edit_mcp_server']
      .map((name) => manifest.tools.find((tool) => tool.name === name)?.description)
      .join(' ')
    expect(mcpServerDescriptions).toContain('concrete workspace-shared header/env values')
    expect(mcpServerDescriptions).not.toContain('[redacted]')
    const editWidgetSchemaText = JSON.stringify(editWidgetProperties)
    expect(editWidgetSchemaText).toContain('layout-scoped color-store channel')
    expect(editWidgetSchemaText).toContain('get_widgets_metadata.linkedParamFields')
    expect(editWidgetSchemaText).toContain('clear the whole selected color channel')
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'edit_workflow',
        'edit_workflow_block',
        'create_skill',
        'edit_skill',
        'create_custom_tool',
        'edit_custom_tool',
        'create_indicator',
        'edit_indicator',
        'create_mcp_server',
        'edit_mcp_server',
        'create_watchlist',
        'rename_watchlist',
        'create_workflow',
        'list_layout',
        'read_layout',
        'edit_layout',
        'edit_widget',
        'get_available_widgets',
        'get_widgets_metadata',
        'get_agent_accessory_catalog',
        'get_indicator_catalog',
        'get_indicator_metadata',
        'rename_skill',
      ])
    )
    const editWatchlist = manifest.tools.find((tool) => tool.name === 'edit_watchlist')
    const createWatchlist = manifest.tools.find((tool) => tool.name === 'create_watchlist')
    const renameWatchlist = manifest.tools.find((tool) => tool.name === 'rename_watchlist')
    expect(createWatchlist).toMatchObject({ kind: 'create', entityKind: 'watchlist' })
    expect(renameWatchlist).toMatchObject({ kind: 'rename', entityKind: 'watchlist' })
    expect(editWatchlist?.description).not.toContain('listingIdentity')
    expect(editWatchlist?.description).toContain('`listing`')
  })
})
