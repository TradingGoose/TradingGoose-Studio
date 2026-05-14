'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiffViewer } from '@/components/ui/diff-viewer'
import { type CopilotAccessLevel, shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { useCopilotStore } from '@/stores/copilot/store'
import {
  getCopilotToolMetadata,
  getToolInterruptDisplays,
  isCopilotTool,
  isGatedTool,
} from '@/stores/copilot/tool-registry'
import type { CopilotToolCall } from '@/stores/copilot/types'
import { PreviewWorkflow } from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-workflow'

type WorkflowReviewPayload = {
  workflowState: Record<string, any>
  previewDiffOperations: Array<{ operation_type?: string; block_id?: string }>
  warnings: string[]
  addedBlocksCount: number
  removedBlocksCount: number
  addedEdgesCount: number
  removedEdgesCount: number
}
type EntityReviewPayload = {
  title: string
  documentDiff: {
    before: string
    after: string
  }
}

interface InlineToolCallProps {
  toolCall?: CopilotToolCall
  toolCallId?: string
  onStateChange?: (state: any) => void
}

const ACTION_VERBS = [
  'Analyzing',
  'Analyzed',
  'Exploring',
  'Explored',
  'Fetching',
  'Fetched',
  'Retrieved',
  'Retrieving',
  'Reading',
  'Read',
  'Listing',
  'Listed',
  'Editing',
  'Edited',
  'Running',
  'Ran',
  'Designing',
  'Designed',
  'Searching',
  'Searched',
  'Debugging',
  'Debugged',
  'Validating',
  'Validated',
  'Adjusting',
  'Adjusted',
  'Summarizing',
  'Summarized',
  'Marking',
  'Marked',
  'Planning',
  'Planned',
  'Preparing',
  'Failed',
  'Aborted',
  'Skipped',
  'Review',
  'Finding',
  'Found',
  'Evaluating',
  'Evaluated',
  'Finished',
  'Setting',
  'Set',
  'Applied',
  'Applying',
  'Rejected',
  'Deploy',
  'Deploying',
  'Deployed',
  'Redeploying',
  'Redeployed',
  'Redeploy',
  'Undeploy',
  'Undeploying',
  'Undeployed',
  'Checking',
  'Checked',
  'Opening',
  'Opened',
  'Create',
  'Creating',
  'Created',
  'Rename',
  'Renaming',
  'Renamed',
  'Generating',
  'Generated',
  'Rendering',
  'Rendered',
  'Sleeping',
  'Slept',
  'Resumed',
] as const

function splitActionVerb(text: string): [string | null, string] {
  for (const verb of ACTION_VERBS) {
    if (text.startsWith(`${verb} `)) {
      return [verb, text.slice(verb.length)]
    }
    if (text === verb || text.startsWith(verb)) {
      const afterVerb = text.slice(verb.length)
      if (afterVerb === '' || afterVerb.startsWith(' ')) {
        return [verb, afterVerb]
      }
    }
  }
  return [null, text]
}

function ShimmerOverlayText({
  text,
  active = false,
  className,
}: {
  text: string
  active?: boolean
  className?: string
}) {
  const [actionVerb, remainder] = splitActionVerb(text)

  return (
    <span className={`relative inline-block ${className || ''}`}>
      {actionVerb ? (
        <>
          <span className='text-foreground'>{actionVerb}</span>
          <span className='text-muted-foreground'>{remainder}</span>
        </>
      ) : (
        <span>{text}</span>
      )}
      {active ? (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 select-none overflow-hidden'
        >
          <span
            className='block text-transparent'
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
              mixBlendMode: 'screen',
            }}
          >
            {text}
          </span>
        </span>
      ) : null}
      <style>{`
        @keyframes toolcall-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>
    </span>
  )
}

function shouldShowToolActionButtons(
  toolCall: CopilotToolCall,
  accessLevel: CopilotAccessLevel
): boolean {
  if (!isCopilotTool(toolCall.name)) {
    return false
  }

  const hasInterrupt = !!getToolInterruptDisplays(toolCall.name, toolCall.id)

  if (hasInterrupt && toolCall.state === ClientToolCallState.review) {
    return true
  }

  return (
    toolCall.state === 'pending' &&
    shouldRequireToolApproval(accessLevel, isGatedTool(toolCall.name))
  )
}

function isEntityMutationTool(toolName: string): boolean {
  return (
    toolName === 'create_skill' ||
    toolName === 'edit_skill' ||
    toolName === 'rename_skill' ||
    toolName === 'create_custom_tool' ||
    toolName === 'edit_custom_tool' ||
    toolName === 'rename_custom_tool' ||
    toolName === 'create_indicator' ||
    toolName === 'edit_indicator' ||
    toolName === 'rename_indicator' ||
    toolName === 'create_mcp_server' ||
    toolName === 'edit_mcp_server' ||
    toolName === 'rename_mcp_server'
  )
}

function readEntityReviewPayload(toolCall: CopilotToolCall): EntityReviewPayload | null {
  if (!isEntityMutationTool(toolCall.name) || toolCall.state !== ClientToolCallState.review) {
    return null
  }

  const result = toolCall.result && typeof toolCall.result === 'object' ? toolCall.result : null
  const documentDiff = result?.preview?.documentDiff
  if (
    !documentDiff ||
    typeof documentDiff.before !== 'string' ||
    typeof documentDiff.after !== 'string' ||
    documentDiff.before === documentDiff.after
  ) {
    return null
  }

  const entityLabel =
    result?.entityKind === 'custom_tool'
      ? 'Custom Tool'
      : result?.entityKind === 'mcp_server'
        ? 'MCP Server'
        : result?.entityKind === 'indicator'
          ? 'Indicator'
          : result?.entityKind === 'skill'
            ? 'Skill'
            : 'Entity'
  return {
    title: `Proposed ${entityLabel} Changes`,
    documentDiff,
  }
}

function readWorkflowReviewPayload(toolCall: CopilotToolCall): WorkflowReviewPayload | null {
  if (toolCall.name !== 'edit_workflow' && toolCall.name !== 'edit_workflow_block') {
    return null
  }

  const result =
    toolCall.result && typeof toolCall.result === 'object'
      ? (toolCall.result as Record<string, any>)
      : null
  const workflowState =
    result?.workflowState && typeof result.workflowState === 'object'
      ? (result.workflowState as Record<string, any>)
      : null

  if (!workflowState) {
    return null
  }

  const blockDiff =
    result?.preview?.blockDiff && typeof result.preview.blockDiff === 'object'
      ? (result.preview.blockDiff as {
          added?: string[]
          removed?: string[]
          updated?: string[]
        })
      : null
  const warnings = Array.isArray(result?.preview?.warnings)
    ? (result.preview.warnings as string[])
    : []
  const addedEdgesCount = Array.isArray(result?.preview?.edgeDiff?.added)
    ? result.preview.edgeDiff.added.length
    : 0
  const removedEdgesCount = Array.isArray(result?.preview?.edgeDiff?.removed)
    ? result.preview.edgeDiff.removed.length
    : 0

  const previewDiffOperations = [
    ...(blockDiff?.added || []).map((block_id) => ({ operation_type: 'add', block_id })),
    ...(blockDiff?.updated || []).map((block_id) => ({ operation_type: 'edit', block_id })),
  ]

  return {
    workflowState,
    previewDiffOperations,
    warnings,
    addedBlocksCount: Array.isArray(blockDiff?.added) ? blockDiff.added.length : 0,
    removedBlocksCount: Array.isArray(blockDiff?.removed) ? blockDiff.removed.length : 0,
    addedEdgesCount,
    removedEdgesCount,
  }
}

function getDisplayName(toolCall: CopilotToolCall): string {
  // Prefer display resolved in the copilot store (SSOT) for client tools
  const fromStore = (toolCall as any).display?.text
  if (fromStore) return fromStore

  try {
    const byState = getCopilotToolMetadata(toolCall.name)?.displayNames?.[toolCall.state]
    if (byState?.text) return byState.text
  } catch {}

  return toolCall.name
}

function ToolActionButtons({
  toolCall,
  onStateChange,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const actionInProgressRef = useRef(false)
  const { executeCopilotToolCall, skipCopilotToolCall } = useCopilotStore()
  const interruptDisplays = getToolInterruptDisplays(toolCall.name, toolCall.id)
  const isReview = toolCall.state === ClientToolCallState.review
  const acceptText = interruptDisplays?.accept?.text ?? (isReview ? 'Accept' : 'Allow')
  const rejectText = interruptDisplays?.reject?.text ?? (isReview ? 'Reject' : 'Skip')
  const AcceptIcon = interruptDisplays?.accept?.icon
  const RejectIcon = interruptDisplays?.reject?.icon

  const onAccept = async () => {
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    try {
      onStateChange?.('executing')
      await executeCopilotToolCall(toolCall.id)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  return (
    <div className='flex items-center gap-1.5'>
      <Button onClick={onAccept} disabled={isProcessing} size='sm'>
        {isProcessing ? (
          <Loader2 className='mr-1 h-3 w-3 animate-spin' />
        ) : AcceptIcon ? (
          <AcceptIcon className='mr-1 h-3 w-3' />
        ) : null}
        {acceptText}
      </Button>
      <Button
        onClick={async () => {
          if (actionInProgressRef.current) return
          await skipCopilotToolCall(toolCall.id)
          onStateChange?.('rejected')
        }}
        disabled={isProcessing}
        size='sm'
        variant='outline'
      >
        {RejectIcon ? <RejectIcon className='mr-1 h-3 w-3' /> : null}
        {rejectText}
      </Button>
    </div>
  )
}

export function InlineToolCall({
  toolCall: toolCallProp,
  toolCallId,
  onStateChange,
}: InlineToolCallProps) {
  const [, forceUpdate] = useState({})
  const liveToolCall = useCopilotStore((s) =>
    toolCallId ? s.toolCallsById[toolCallId] : undefined
  )
  const toolCall = liveToolCall || toolCallProp
  const toolName = toolCall?.name || ''
  const toolState = toolCall?.state || (ClientToolCallState.pending as any)

  const isExpandablePending =
    toolState === 'pending' &&
    (toolName === 'make_api_request' ||
      toolName === 'set_environment_variables' ||
      toolName === 'set_workflow_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const isExpandableTool =
    toolName === 'make_api_request' ||
    toolName === 'set_environment_variables' ||
    toolName === 'set_workflow_variables'

  const accessLevel = useCopilotStore((s) => s.accessLevel)

  // Guard: nothing to render without a toolCall
  if (!toolCall) return null

  const showButtons = shouldShowToolActionButtons(toolCall, accessLevel)
  const showMoveToBackground =
    toolCall.name === 'run_workflow' &&
    (toolCall.state === (ClientToolCallState.executing as any) ||
      toolCall.state === ('executing' as any))

  const handleStateChange = (state: any) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)
  const params = (toolCall as any).parameters || (toolCall as any).input || toolCall.params || {}
  const entityReviewPayload = readEntityReviewPayload(toolCall)
  const workflowReviewPayload = readWorkflowReviewPayload(toolCall)
  const showWorkflowReview = workflowReviewPayload && toolCall.state === ClientToolCallState.review

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = params.url || ''
      const method = (params.method || '').toUpperCase()
      return (
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-2 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Method
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Endpoint
            </div>
          </div>
          <div className='grid grid-cols-[auto_1fr] items-center gap-2 px-2 py-2'>
            <div>
              <span className='inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs'>
                {method || 'GET'}
              </span>
            </div>
            <div className='min-w-0'>
              <span
                className='block overflow-x-auto whitespace-nowrap font-mono text-foreground text-xs'
                title={url}
              >
                {url || 'URL not provided'}
              </span>
            </div>
          </div>
        </div>
      )
    }

    if (toolCall.name === 'set_environment_variables') {
      const variables =
        params.variables && typeof params.variables === 'object' ? params.variables : {}

      // Normalize variables - handle both direct key-value and nested {name, value} format
      const normalizedEntries: Array<[string, string]> = []
      Object.entries(variables).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'name' in value && 'value' in value) {
          // Handle {name: "key", value: "val"} format
          normalizedEntries.push([String((value as any).name), String((value as any).value)])
        } else {
          // Handle direct key-value format
          normalizedEntries.push([key, String(value)])
        }
      })

      return (
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-2 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Name
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Value
            </div>
          </div>
          {normalizedEntries.length === 0 ? (
            <div className='px-2 py-2 text-muted-foreground text-xs'>No variables provided</div>
          ) : (
            <div className='divide-y divide-muted/60'>
              {normalizedEntries.map(([name, value]) => (
                <div
                  key={name}
                  className='grid grid-cols-[auto_1fr] items-center gap-2 px-2 py-1.5'
                >
                  <div className='truncate font-medium text-xs text-yellow-800 dark:text-yellow-200'>
                    {name}
                  </div>
                  <div className='min-w-0'>
                    <span className='block overflow-x-auto whitespace-nowrap font-mono text-xs text-yellow-700 dark:text-yellow-300'>
                      {value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (toolCall.name === 'set_workflow_variables') {
      const ops = Array.isArray(params.operations) ? (params.operations as any[]) : []
      return (
        <div className='mt-0.5 w-full overflow-hidden rounded border border-muted bg-card'>
          <div className='grid grid-cols-3 gap-0 border-muted/60 border-b bg-muted/40 px-2 py-1.5'>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Name
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Type
            </div>
            <div className='font-medium text-[10px] text-muted-foreground uppercase tracking-wide'>
              Value
            </div>
          </div>
          {ops.length === 0 ? (
            <div className='px-2 py-2 text-muted-foreground text-xs'>No operations provided</div>
          ) : (
            <div className='divide-y divide-yellow-200 dark:divide-yellow-800'>
              {ops.map((op, idx) => (
                <div key={idx} className='grid grid-cols-3 items-center gap-0 px-2 py-1.5'>
                  <div className='min-w-0'>
                    <span className='truncate text-xs text-yellow-800 dark:text-yellow-200'>
                      {String(op.name || '')}
                    </span>
                  </div>
                  <div>
                    <span className='rounded border px-1 py-0.5 text-[10px] text-muted-foreground'>
                      {String(op.type || '')}
                    </span>
                  </div>
                  <div className='min-w-0'>
                    {op.value !== undefined ? (
                      <span className='block overflow-x-auto whitespace-nowrap font-mono text-xs text-yellow-700 dark:text-yellow-300'>
                        {String(op.value)}
                      </span>
                    ) : (
                      <span className='text-muted-foreground text-xs'>—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  // Compute icon element from tool display metadata, defaulting to Loader2.
  const renderDisplayIcon = () => {
    try {
      // Determine the icon component (prefer store, then registry, else Loader2)
      const IconFromStore = (toolCall as any).display?.icon
      let IconComp: any | undefined = IconFromStore
      if (!IconComp) {
        try {
          IconComp = getCopilotToolMetadata(toolCall.name)?.displayNames?.[toolCall.state]?.icon
        } catch {}
      }
      if (!IconComp) IconComp = Loader2

      // Color by state
      let colorClass = ''
      const state = toolCall.state as any
      if (state === (ClientToolCallState as any).aborted || state === 'aborted') {
        colorClass = 'text-yellow-500'
      } else if (state === (ClientToolCallState as any).error || state === 'error') {
        colorClass = 'text-red-500'
      } else if (state === (ClientToolCallState as any).success || state === 'success') {
        const isBuildOrEdit = toolCall.name === 'edit_workflow'
        colorClass = isBuildOrEdit ? 'text-primary-hover' : 'text-green-600'
      }

      const isLoadingState =
        toolCall.state === ClientToolCallState.pending ||
        toolCall.state === ClientToolCallState.executing

      // Only Loader2 should spin (while loading)
      const spinClass = IconComp === Loader2 && isLoadingState ? 'animate-spin' : ''

      return <IconComp className={`h-3 w-3 ${spinClass} ${colorClass}`} />
    } catch {
      return <Loader2 className='h-3 w-3 animate-spin' />
    }
  }

  const isLoadingState =
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

  const isToolNameClickable = isExpandableTool

  return (
    <div className='flex w-full flex-col gap-1 py-1'>
      <div
        className={`flex items-center justify-between gap-2 ${isToolNameClickable ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (isExpandableTool) {
            setExpanded((e) => !e)
          }
        }}
      >
        <div className='flex items-center gap-2 text-muted-foreground'>
          <div className='flex-shrink-0'>{renderDisplayIcon()}</div>
          <ShimmerOverlayText text={displayName} active={isLoadingState} className='text-sm' />
        </div>
        {showButtons ? (
          <ToolActionButtons toolCall={toolCall} onStateChange={handleStateChange} />
        ) : showMoveToBackground ? (
          <Button
            // Intentionally minimal wiring per requirements
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                // Transition to background state locally so UI updates immediately
                instance?.setState?.((ClientToolCallState as any).background)
                await instance?.markToolComplete?.(
                  200,
                  'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete'
                )
                // Optionally force a re-render; store should sync state from server
                forceUpdate({})
                onStateChange?.('background')
              } catch {}
            }}
            size='sm'
            variant='secondary'
            title='Move to Background'
          >
            Move to Background
          </Button>
        ) : null}
      </div>
      {isExpandableTool && expanded && <div className='pr-1 pl-5'>{renderPendingDetails()}</div>}
      {entityReviewPayload ? (
        <div className='pr-1 pl-5'>
          <div className='flex flex-col gap-3 rounded-md border border-border/60 bg-card/60 p-3'>
            <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
              {entityReviewPayload.title}
            </div>
            <DiffViewer
              oldFile={{ name: 'Current', content: entityReviewPayload.documentDiff.before }}
              newFile={{ name: 'Proposed', content: entityReviewPayload.documentDiff.after }}
              viewMode='unified'
              showIcon={false}
              size='sm'
              className='rounded-md border-border/60 bg-background/70'
            />
          </div>
        </div>
      ) : null}
      {showWorkflowReview && workflowReviewPayload ? (
        <div className='pr-1 pl-5'>
          <div className='flex flex-col gap-3 rounded-md border border-border/60 bg-card/60 p-3'>
            {workflowReviewPayload.addedBlocksCount > 0 ||
            workflowReviewPayload.removedBlocksCount > 0 ||
            workflowReviewPayload.addedEdgesCount > 0 ||
            workflowReviewPayload.removedEdgesCount > 0 ? (
              <div className='flex flex-wrap items-center gap-3 text-muted-foreground text-xs'>
                {(workflowReviewPayload.addedBlocksCount > 0 ||
                  workflowReviewPayload.removedBlocksCount > 0) && (
                  <>
                    <span>Blocks +{workflowReviewPayload.addedBlocksCount}</span>
                    <span>Blocks -{workflowReviewPayload.removedBlocksCount}</span>
                  </>
                )}
                {(workflowReviewPayload.addedEdgesCount > 0 ||
                  workflowReviewPayload.removedEdgesCount > 0) && (
                  <>
                    <span>Edges +{workflowReviewPayload.addedEdgesCount}</span>
                    <span>Edges -{workflowReviewPayload.removedEdgesCount}</span>
                  </>
                )}
              </div>
            ) : null}

            {workflowReviewPayload.warnings.length > 0 ? (
              <div className='flex flex-col gap-1'>
                <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
                  Warnings
                </div>
                <ul className='list-disc space-y-1 pl-4 text-muted-foreground text-xs'>
                  {workflowReviewPayload.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <PreviewWorkflow
              workflowState={workflowReviewPayload.workflowState as any}
              diffOperations={workflowReviewPayload.previewDiffOperations}
              height={240}
              defaultZoom={0.7}
              fitPadding={0.18}
              showInspector={false}
              framed={false}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
