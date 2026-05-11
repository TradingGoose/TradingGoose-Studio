import {
  Blocks,
  BookOpen,
  BookOpenText,
  Bot,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Globe2,
  Key,
  KeyRound,
  ListFilter,
  Loader2,
  MinusCircle,
  Settings2,
  TerminalSquare,
  X,
  XCircle,
} from 'lucide-react'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export const SERVER_TOOL_METADATA = {
  [CopilotTool.read_workflow_logs]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading workflow logs', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading workflow logs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read workflow logs', icon: TerminalSquare },
      [ClientToolCallState.error]: { text: 'Failed to read workflow logs', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading workflow logs',
        icon: MinusCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading workflow logs',
        icon: MinusCircle,
      },
      [ClientToolCallState.pending]: { text: 'Reading workflow logs', icon: Loader2 },
    },
  },
  [CopilotTool.get_available_blocks]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring workflow blocks', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored workflow blocks', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to explore workflow blocks', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted exploring workflow blocks',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped exploring workflow blocks',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.get_blocks_metadata]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Inspecting block shapes', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Inspected block shapes', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to inspect block shapes', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted inspecting block shapes', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped inspecting block shapes',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.get_agent_accessory_catalog]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring agent accessories', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring agent accessories', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring agent accessories', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored agent accessories', icon: Bot },
      [ClientToolCallState.error]: { text: 'Failed to explore agent accessories', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted exploring agent accessories',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped exploring agent accessories',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.get_indicator_catalog]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring indicator catalog', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored indicator catalog', icon: BookOpenText },
      [ClientToolCallState.error]: { text: 'Failed to explore indicator catalog', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted exploring indicator catalog',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped exploring indicator catalog',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.get_indicator_metadata]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Inspecting indicator metadata', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Inspected indicator metadata', icon: FileSearch },
      [ClientToolCallState.error]: { text: 'Failed to inspect indicator metadata', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted inspecting indicator metadata',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped inspecting indicator metadata',
        icon: MinusCircle,
      },
    },
  },
  search_online: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Online search complete', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
    },
  },
  search_documentation: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Documentation search complete', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
  },
  [CopilotTool.read_environment_variables]: {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Reading environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read environment variables', icon: KeyRound },
      [ClientToolCallState.error]: { text: 'Failed to read environment variables', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading environment variables',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading environment variables',
        icon: MinusCircle,
      },
    },
  },
  set_environment_variables: {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set environment variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Set environment variables', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set environment variables', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted setting environment variables',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped setting environment variables',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
  },
  [CopilotTool.read_credentials]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading connected integrations', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading connected integrations', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading connected integrations', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read connected integrations', icon: Key },
      [ClientToolCallState.error]: {
        text: 'Failed to fetch connected integrations',
        icon: XCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading connected integrations',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading connected integrations',
        icon: MinusCircle,
      },
    },
  },
  list_gdrive_files: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Listed GDrive files', icon: FolderOpen },
      [ClientToolCallState.error]: { text: 'Failed to list GDrive files', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing GDrive files', icon: MinusCircle },
    },
  },
  read_gdrive_file: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading Google Drive file', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read Google Drive file', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to read Google Drive file', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted reading Google Drive file', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading Google Drive file',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.read_oauth_credentials]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading OAuth credentials', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading OAuth credentials', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Retrieving login IDs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved login IDs', icon: Key },
      [ClientToolCallState.error]: { text: 'Failed to retrieve login IDs', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading OAuth credentials',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading OAuth credentials',
        icon: MinusCircle,
      },
    },
  },
  make_api_request: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing API request', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Review API request', icon: Globe2 },
      [ClientToolCallState.executing]: { text: 'Executing API request', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'API request complete', icon: Globe2 },
      [ClientToolCallState.error]: { text: 'Failed to execute API request', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped API request', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted API request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Execute', icon: Globe2 },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  },
} satisfies Record<string, BaseClientToolMetadata>
