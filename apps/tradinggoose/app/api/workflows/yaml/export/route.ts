import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { simAgentClient } from '@/lib/copilot/agent/client'
import { extractSubBlockValuesFromBlocks } from '@/lib/copilot/workflow/block-output-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { loadEditableWorkflowState } from '@/lib/workflows/db-helpers'
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

    // Get the session for authentication
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch workflow metadata for access checks.
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    let hasAccess = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      hasAccess = true
    }

    // Case 2: Workflow belongs to a workspace the user has permissions for
    if (!hasAccess && workflowData.workspaceId) {
      const workspaceAccess = await checkWorkspaceAccess(workflowData.workspaceId, userId)
      if (workspaceAccess.hasAccess) {
        hasAccess = true
      }
    }

    if (!hasAccess) {
      logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const editableState = await loadEditableWorkflowState(workflowId)

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

    // Ensure loop blocks have their data populated with defaults
    if (workflowState.blocks) {
      Object.entries(workflowState.blocks).forEach(([blockId, block]: [string, any]) => {
        if (block.type === 'loop') {
          // Ensure data field exists
          if (!block.data) {
            block.data = {}
          }

          // Apply defaults if not set
          if (!block.data.loopType) {
            block.data.loopType = 'for'
          }
          if (!block.data.count && block.data.count !== 0) {
            block.data.count = 5
          }
          if (!block.data.collection) {
            block.data.collection = ''
          }
          if (!block.data.maxConcurrency) {
            block.data.maxConcurrency = 1
          }

          logger.debug(`[${requestId}] Applied defaults to loop block ${blockId}:`, {
            loopType: block.data.loopType,
            count: block.data.count,
          })
        }
      })
    }

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
    return NextResponse.json(
      {
        success: false,
        error: `Failed to export YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
