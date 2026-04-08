import {
  MCP_EDITOR_ACTION_EVENT,
  type McpEditorActionEventDetail,
} from '@/widgets/events'
import {
  createEditorActionsHook,
  createEmitEditorAction,
} from '@/widgets/utils/editor-actions'

type McpAction = McpEditorActionEventDetail['action']

export const useMcpEditorActions =
  createEditorActionsHook<McpAction>(MCP_EDITOR_ACTION_EVENT)

export const emitMcpEditorAction =
  createEmitEditorAction<McpAction>(MCP_EDITOR_ACTION_EVENT)
