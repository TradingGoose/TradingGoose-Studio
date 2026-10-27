import { type NextRequest, NextResponse } from 'next/server'
import { simAgentClient } from '@/lib/copilot/agent/client'
import { extractSubBlockValuesFromBlocks } from '@/lib/copilot/workflow/block-output-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { requireWorkflowRealtimeState } from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createWorkflowRealtimeRequiredResponse } from '@/app/api/workflows/utils'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowYamlExportAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const url = new URL(request.url)
  const workflowId = url.searchParams.get('workflowId')

  try {
    logger.info(`[${requestId}] Exporting workflow YAML from workflow state: ${workflowId}`)

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 })
    }

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      workflowId,
      requestId,
      'read'
    )
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    const editableState = await requireWorkflowRealtimeState(workflowId)

    if (!editableState) {
      return NextResponse.json(
        { success: false, error: 'Workflow has no state data' },
        { status: 400 }
      )
    }

    const workflowState: any = {
      deploymentStatuses: {},
      ...(editableState.direction !== undefined ? { direction: editableState.direction } : {}),
      blocks: editableState.blocks,
      edges: editableState.edges,
      loops: editableState.loops,
      parallels: editableState.parallels,
      variables: editableState.variables || {},
      lastSaved: editableState.lastSaved ?? Date.now(),
      isDeployed: workflowData.isDeployed ?? false,
      deployedAt: workflowData.deployedAt,
    }

    logger.info(`[${requestId}] Loaded editable workflow ${workflowId} from Yjs`, {
      blocksCount: Object.keys(workflowState.blocks).length,
      edgesCount: workflowState.edges.length,
      variablesCount: Object.keys(workflowState.variables || {}).length,
    })

    const subBlockValues = extractSubBlockValuesFromBlocks(workflowState.blocks || {})

    // Gather block registry and utilities for copilot
    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce(
      (acc, block) => {
        const blockType = block.type
        acc[blockType] = {
          ...block,
          id: blockType,
          subBlocks: block.subBlocks || [],
          outputs: block.outputs || {},
        } as any
        return acc
      },
      {} as Record<string, BlockConfig>
    )

    // Call copilot directly
    const result = await simAgentClient.makeRequest('/api/workflow/to-yaml', {
      body: {
        workflowState,
        subBlockValues,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
      },
    })

    if (!result.success || !result.data?.yaml) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to generate YAML',
        },
        { status: result.status || 500 }
      )
    }

    logger.info(`[${requestId}] Successfully generated YAML from workflow state`, {
      yamlLength: result.data.yaml.length,
    })

    return NextResponse.json({
      success: true,
      yaml: result.data.yaml,
    })
  } catch (error) {
    logger.error(`[${requestId}] YAML export failed`, error)
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return NextResponse.json(
      {
        success: false,
        error: `Failed to export YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
