'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ListingDisplayRow } from '@/components/listing-selector/listing/row'
import { Button } from '@/components/ui/button'
import { DiffViewer } from '@/components/ui/diff-viewer'
import { type CopilotAccessLevel, shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { DashboardLayoutReviewPreview } from '@/lib/copilot/components/dashboard-layout-review-preview'
import { parseEntityDocument, WATCHLIST_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { buildListingDisplayOption, getListingIdentityKey } from '@/lib/listing/identity'
import type { DashboardLayoutReviewDiff } from '@/widgets/layout-document'
import type {
  WatchlistDocumentInputFields,
  WatchlistDocumentInputItem,
} from '@/lib/watchlists/types'
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
type WatchlistReviewPayload = {
  title: string
  before: WatchlistDocumentInputFields | null
  after: WatchlistDocumentInputFields
}
type DashboardLayoutReviewPayload =
  {
    title: string
    layoutDiff: DashboardLayoutReviewDiff
  }
type WatchlistReviewContainer = {
  id: string
  type: 'section'
  label: string
  listings: Extract<WatchlistDocumentInputItem, { type: 'listing' }>[]
  containers: WatchlistReviewContainer[]
}

interface InlineToolCallProps {
  toolCall?: CopilotToolCall
  toolCallId?: string
  onStateChange?: (state: ClientToolCallState) => void
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

const REDACTED_VALUE = '[redacted]'

function redactUrlQuery(value: unknown): string {
  const url = String(value || '')
  const queryStart = url.indexOf('?')
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?${REDACTED_VALUE}`
}

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
    toolCall.state === ClientToolCallState.pending &&
    shouldRequireToolApproval(accessLevel, isGatedTool(toolCall.name))
  )
}

function isStagedPreviewState(state: ClientToolCallState): boolean {
  return state === ClientToolCallState.review || state === ClientToolCallState.success
}

function isEntityReviewKind(entityKind: unknown): entityKind is string {
  return (
    entityKind === 'skill' ||
    entityKind === 'custom_tool' ||
    entityKind === 'indicator' ||
    entityKind === 'mcp_server' ||
    entityKind === 'knowledge_base' ||
    entityKind === 'watchlist' ||
    entityKind === 'dashboard_layout' ||
    entityKind === 'workflow'
  )
}

function readEntityReviewPayload(toolCall: CopilotToolCall): EntityReviewPayload | null {
  if (!isCopilotTool(toolCall.name) || !isStagedPreviewState(toolCall.state)) {
    return null
  }

  const result = toolCall.result && typeof toolCall.result === 'object' ? toolCall.result : null
  if (!isEntityReviewKind(result?.entityKind)) {
    return null
  }

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
    result?.entityKind === 'workflow' && toolCall.name === 'edit_workflow_variable'
      ? 'Workflow Variable'
      : result?.entityKind === 'dashboard_layout' && toolCall.name === 'edit_widget'
        ? 'Widget'
      : result?.entityKind === 'custom_tool'
        ? 'Custom Tool'
        : result?.entityKind === 'mcp_server'
          ? 'MCP Server'
          : result?.entityKind === 'knowledge_base'
            ? 'Knowledge Base'
            : result?.entityKind === 'indicator'
              ? 'Indicator'
              : result?.entityKind === 'skill'
                ? 'Skill'
                : result?.entityKind === 'dashboard_layout'
                  ? 'Dashboard Layout'
                : 'Entity'
  return {
    title:
      toolCall.state === ClientToolCallState.success
        ? `Applied ${entityLabel} Changes`
        : `Proposed ${entityLabel} Changes`,
    documentDiff,
  }
}

function readDashboardLayoutReviewPayload(toolCall: CopilotToolCall): DashboardLayoutReviewPayload | null {
  if (!isStagedPreviewState(toolCall.state)) return null
  if (toolCall.name !== 'edit_layout') return null

  const result =
    toolCall.result && typeof toolCall.result === 'object'
      ? (toolCall.result as Record<string, any>)
      : null
  if (result?.entityKind !== 'dashboard_layout') return null

  const layoutDiff = result?.preview?.layoutDiff
  if (
    !layoutDiff ||
    typeof layoutDiff !== 'object' ||
    !layoutDiff.before ||
    !layoutDiff.after ||
    typeof layoutDiff.before !== 'object' ||
    typeof layoutDiff.after !== 'object'
  ) {
    return null
  }

  return {
    title:
      toolCall.state === ClientToolCallState.success
        ? 'Applied Dashboard Layout Changes'
        : 'Proposed Dashboard Layout Changes',
    layoutDiff: layoutDiff as DashboardLayoutReviewDiff,
  }
}

function readWatchlistReviewDocument(value: string): WatchlistDocumentInputFields | null {
  if (!value.trim()) {
    return null
  }

  try {
    return parseEntityDocument('watchlist', value) as WatchlistDocumentInputFields
  } catch {
    return null
  }
}

function readWatchlistReviewPayload(toolCall: CopilotToolCall): WatchlistReviewPayload | null {
  if (!isStagedPreviewState(toolCall.state)) {
    return null
  }
  if (
    toolCall.name !== 'create_watchlist' &&
    toolCall.name !== 'edit_watchlist' &&
    toolCall.name !== 'rename_watchlist'
  ) {
    return null
  }

  const result =
    toolCall.result && typeof toolCall.result === 'object'
      ? (toolCall.result as Record<string, any>)
      : null
  if (result?.entityKind !== 'watchlist') {
    return null
  }
  if (result.documentFormat && result.documentFormat !== WATCHLIST_DOCUMENT_FORMAT) {
    return null
  }

  const documentDiff = result?.preview?.documentDiff
  if (
    !documentDiff ||
    typeof documentDiff.before !== 'string' ||
    typeof documentDiff.after !== 'string' ||
    documentDiff.before === documentDiff.after
  ) {
    return null
  }

  const beforeText = documentDiff.before.trim()
  const before = beforeText ? readWatchlistReviewDocument(documentDiff.before) : null
  const after = readWatchlistReviewDocument(documentDiff.after)
  if (!after) {
    return null
  }
  if (toolCall.name !== 'create_watchlist' && !before) {
    return null
  }

  return {
    title:
      toolCall.state === ClientToolCallState.success
        ? 'Applied Watchlist Changes'
        : 'Proposed Watchlist Changes',
    before,
    after,
  }
}

function groupWatchlistReviewItems(items: WatchlistDocumentInputItem[]) {
  const rootKey = '__root__'
  const keyForParent = (parentId: string | null | undefined) => parentId ?? rootKey
  const listingsByParent = new Map<
    string,
    Extract<WatchlistDocumentInputItem, { type: 'listing' }>[]
  >()
  const containersByParent = new Map<
    string,
    Extract<WatchlistDocumentInputItem, { type: 'section' }>[]
  >()

  for (const item of items) {
    const key = keyForParent(item.parentId)
    if (item.type === 'section') {
      containersByParent.set(key, [...(containersByParent.get(key) ?? []), item])
    } else {
      listingsByParent.set(key, [...(listingsByParent.get(key) ?? []), item])
    }
  }

  const buildContainers = (parentId: string | null): WatchlistReviewContainer[] =>
    (containersByParent.get(keyForParent(parentId)) ?? []).map((container) => ({
      id: container.id ?? container.label,
      type: container.type,
      label: container.label,
      listings: listingsByParent.get(container.id ?? '') ?? [],
      containers: container.id ? buildContainers(container.id) : [],
    }))

  return {
    rootListings: listingsByParent.get(rootKey) ?? [],
    containers: buildContainers(null),
  }
}

function WatchlistReviewListingRow({
  item,
}: {
  item: Extract<WatchlistDocumentInputItem, { type: 'listing' }>
}) {
  return (
    <div className='rounded-sm border border-border/50 bg-background/70 px-2 py-1.5'>
      <ListingDisplayRow
        listing={buildListingDisplayOption(item.listing)}
        showSecondary
        className='min-h-5'
      />
    </div>
  )
}

function WatchlistReviewDocumentView({
  label,
  document,
}: {
  label: string
  document: WatchlistDocumentInputFields | null
}) {
  if (!document) {
    return (
      <div className='flex min-h-20 flex-col gap-2 rounded-md border border-border/60 bg-background/70 p-2'>
        <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
          {label}
        </div>
        <div className='text-muted-foreground text-xs'>No existing watchlist document.</div>
      </div>
    )
  }

  const grouped = groupWatchlistReviewItems(document.items)
  const settings = [
    ['Logo', document.settings.showLogo],
    ['Ticker', document.settings.showTicker],
    ['Description', document.settings.showDescription],
  ] as const

  const renderContainer = (container: WatchlistReviewContainer, depth = 0) => (
    <div key={container.id} className='flex flex-col gap-1.5'>
      <div
        className='rounded-sm bg-muted/60 px-2 py-1 font-medium text-muted-foreground text-xs'
        style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
      >
        {container.label}
      </div>
      {container.listings.map((item, itemIndex) => (
        <div
          key={item.id ?? `${getListingIdentityKey(item.listing)}-${itemIndex}`}
          style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
        >
          <WatchlistReviewListingRow item={item} />
        </div>
      ))}
      {container.containers.map((childContainer) => renderContainer(childContainer, depth + 1))}
    </div>
  )

  return (
    <div className='flex min-w-0 flex-col gap-2 rounded-md border border-border/60 bg-background/70 p-2'>
      <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
        {label}
      </div>
      <div className='min-w-0'>
        <div className='truncate font-semibold text-sm'>{document.name}</div>
        <div className='mt-1 flex flex-wrap gap-1'>
          {settings.map(([name, enabled]) => (
            <span
              key={name}
              className='rounded-sm border border-border/60 px-1.5 py-0.5 text-muted-foreground text-[10px]'
            >
              {name}: {enabled ? 'On' : 'Off'}
            </span>
          ))}
        </div>
      </div>
      <div className='flex flex-col gap-1.5'>
        {grouped.rootListings.map((item, index) => (
          <WatchlistReviewListingRow
            key={item.id ?? `${getListingIdentityKey(item.listing)}-${index}`}
            item={item}
          />
        ))}
        {grouped.containers.map((container) => renderContainer(container))}
        {document.items.length === 0 ? (
          <div className='rounded-sm border border-dashed border-border/60 px-2 py-3 text-center text-muted-foreground text-xs'>
            No listings.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function WatchlistReviewDiff({ payload }: { payload: WatchlistReviewPayload }) {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border/60 bg-card/60 p-3'>
      <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
        {payload.title}
      </div>
      <div className='grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2'>
        <WatchlistReviewDocumentView label='Current' document={payload.before} />
        <WatchlistReviewDocumentView label='Proposed' document={payload.after} />
      </div>
    </div>
  )
}

function DashboardLayoutReviewDiff({ payload }: { payload: DashboardLayoutReviewPayload }) {
  return (
    <DashboardLayoutReviewPreview
      title={payload.title}
      layoutDiff={payload.layoutDiff}
    />
  )
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
  onStateChange?: (state: ClientToolCallState) => void
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
      onStateChange?.(ClientToolCallState.executing)
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
          onStateChange?.(ClientToolCallState.rejected)
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
    (toolName === 'make_api_request' || toolName === 'set_environment_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const isExpandableTool =
    toolName === 'make_api_request' || toolName === 'set_environment_variables'

  const accessLevel = useCopilotStore((s) => s.accessLevel)

  if (!toolCall) return null

  const showButtons = shouldShowToolActionButtons(toolCall, accessLevel)
  const showMoveToBackground =
    toolCall.name === 'run_workflow' && toolCall.state === ClientToolCallState.executing

  const handleStateChange = (state: ClientToolCallState) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)
  const params = toolCall.params ?? {}
  const watchlistReviewPayload = readWatchlistReviewPayload(toolCall)
  const dashboardReviewPayload = readDashboardLayoutReviewPayload(toolCall)
  const entityReviewPayload =
    watchlistReviewPayload || dashboardReviewPayload ? null : readEntityReviewPayload(toolCall)
  const workflowReviewPayload = readWorkflowReviewPayload(toolCall)
  const showWorkflowReview = workflowReviewPayload && isStagedPreviewState(toolCall.state)

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = redactUrlQuery(params.url)
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
        params.variables && typeof params.variables === 'object' && !Array.isArray(params.variables)
          ? params.variables
          : {}
      const variableNames = Object.keys(variables)

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
          {variableNames.length === 0 ? (
            <div className='px-2 py-2 text-muted-foreground text-xs'>No variables provided</div>
          ) : (
            <div className='divide-y divide-muted/60'>
              {variableNames.map((name) => (
                <div
                  key={name}
                  className='grid grid-cols-[auto_1fr] items-center gap-2 px-2 py-1.5'
                >
                  <div className='truncate font-medium text-xs text-yellow-800 dark:text-yellow-200'>
                    {name}
                  </div>
                  <div className='min-w-0'>
                    <span className='block overflow-x-auto whitespace-nowrap font-mono text-xs text-yellow-700 dark:text-yellow-300'>
                      {REDACTED_VALUE}
                    </span>
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
      const state = toolCall.state
      if (state === ClientToolCallState.aborted) {
        colorClass = 'text-yellow-500'
      } else if (state === ClientToolCallState.error) {
        colorClass = 'text-red-500'
      } else if (state === ClientToolCallState.success) {
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
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                instance?.setState?.(ClientToolCallState.background)
                await instance?.markToolComplete?.(
                  200,
                  'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete'
                )
                forceUpdate({})
                onStateChange?.(ClientToolCallState.background)
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
      {isExpandableTool && expanded && <div className='px-1'>{renderPendingDetails()}</div>}
      {watchlistReviewPayload ? (
        <div className='px-1'>
          <WatchlistReviewDiff payload={watchlistReviewPayload} />
        </div>
      ) : null}
      {dashboardReviewPayload ? (
        <div className='px-1'>
          <DashboardLayoutReviewDiff payload={dashboardReviewPayload} />
        </div>
      ) : null}
      {entityReviewPayload ? (
        <div className='px-1'>
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
        <div className='px-1'>
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
