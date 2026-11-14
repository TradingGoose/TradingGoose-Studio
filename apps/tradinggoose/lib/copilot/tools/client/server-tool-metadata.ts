import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  Blocks,
  BookOpen,
  BookOpenText,
  Bot,
  Check,
  Code2,
  Database,
  FileJson,
  FileSearch,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Globe2,
  Grid2x2,
  Key,
  KeyRound,
  ListChecks,
  ListFilter,
  Loader2,
  MinusCircle,
  Rocket,
  Server,
  Settings2,
  Tag,
  TerminalSquare,
  Workflow,
  X,
  XCircle,
} from 'lucide-react'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

function createProgressDisplayNames(text: string) {
  return {
    [ClientToolCallState.generating]: { text, icon: Loader2 },
    [ClientToolCallState.pending]: { text, icon: Loader2 },
    [ClientToolCallState.executing]: { text, icon: Loader2 },
  }
}

function createEntityListMetadata(pluralLabel: string, icon: LucideIcon): BaseClientToolMetadata {
  return {
    displayNames: {
      ...createProgressDisplayNames(`Listing ${pluralLabel}`),
      [ClientToolCallState.success]: { text: `Listed ${pluralLabel}`, icon },
      [ClientToolCallState.error]: { text: `Failed to list ${pluralLabel}`, icon: XCircle },
      [ClientToolCallState.aborted]: { text: `Aborted listing ${pluralLabel}`, icon: XCircle },
      [ClientToolCallState.rejected]: { text: `Skipped listing ${pluralLabel}`, icon: MinusCircle },
    },
  }
}

function createEntityReadMetadata(label: string): BaseClientToolMetadata {
  return {
    displayNames: {
      ...createProgressDisplayNames(`Reading ${label} document`),
      [ClientToolCallState.success]: { text: `Read ${label} document`, icon: FileJson },
      [ClientToolCallState.error]: { text: `Failed to read ${label} document`, icon: XCircle },
      [ClientToolCallState.aborted]: { text: `Aborted reading ${label} document`, icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: `Skipped reading ${label} document`,
        icon: MinusCircle,
      },
    },
  }
}

function createEntityMutationMetadata(
  label: string,
  action: 'create' | 'edit' | 'rename',
  icon: LucideIcon
): BaseClientToolMetadata {
  const gerund = action === 'create' ? 'Creating' : action === 'rename' ? 'Renaming' : 'Editing'
  const gerundLower = gerund.toLowerCase()
  const past = action === 'create' ? 'Created' : action === 'rename' ? 'Renamed' : 'Edited'

  return {
    displayNames: {
      ...createProgressDisplayNames(`${gerund} ${label} document`),
      [ClientToolCallState.review]: { text: `Review ${label} changes`, icon },
      [ClientToolCallState.success]: { text: `${past} ${label} document`, icon },
      [ClientToolCallState.error]: {
        text: `Failed to ${action} ${label} document`,
        icon: XCircle,
      },
      [ClientToolCallState.aborted]: {
        text: `Aborted ${gerundLower} ${label} document`,
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: `Skipped ${gerundLower} ${label} document`,
        icon: MinusCircle,
      },
    },
    interrupt: {
      accept: { text: 'Apply changes', icon: Check },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }
}

export const SERVER_TOOL_METADATA = {
  [CopilotTool.read_workflow_logs]: {
    displayNames: {
      ...createProgressDisplayNames('Reading workflow logs'),
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
    },
  },
  [CopilotTool.get_available_blocks]: {
    displayNames: {
      ...createProgressDisplayNames('Exploring workflow blocks'),
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
      ...createProgressDisplayNames('Inspecting block shapes'),
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
      ...createProgressDisplayNames('Exploring agent accessories'),
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
      ...createProgressDisplayNames('Exploring indicator catalog'),
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
      ...createProgressDisplayNames('Inspecting indicator metadata'),
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
      ...createProgressDisplayNames('Searching online'),
      [ClientToolCallState.success]: { text: 'Online search complete', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
    },
  },
  search_documentation: {
    displayNames: {
      ...createProgressDisplayNames('Searching documentation'),
      [ClientToolCallState.success]: { text: 'Documentation search complete', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
  },
  search_listing: {
    displayNames: {
      ...createProgressDisplayNames('Searching listings'),
      [ClientToolCallState.success]: { text: 'Listing search complete', icon: BarChart3 },
      [ClientToolCallState.error]: { text: 'Failed to search listings', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted listing search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing search', icon: MinusCircle },
    },
  },
  [CopilotTool.read_environment_variables]: {
    displayNames: {
      ...createProgressDisplayNames('Reading environment variables'),
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
      ...createProgressDisplayNames('Reading connected integrations'),
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
  list_knowledge_bases: createEntityListMetadata('knowledge bases', Database),
  read_knowledge_base: createEntityReadMetadata('knowledge base'),
  create_knowledge_base: createEntityMutationMetadata('knowledge base', 'create', Database),
  edit_knowledge_base: createEntityMutationMetadata('knowledge base', 'edit', Database),
  rename_knowledge_base: createEntityMutationMetadata('knowledge base', 'rename', Database),
  query_knowledge_base: {
    displayNames: {
      ...createProgressDisplayNames('Querying knowledge base'),
      [ClientToolCallState.success]: { text: 'Queried knowledge base', icon: Database },
      [ClientToolCallState.error]: { text: 'Failed to query knowledge base', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted querying knowledge base', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped querying knowledge base',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.list_workflows]: createEntityListMetadata('workflows', ListChecks),
  [CopilotTool.read_workflow]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Analyzing your workflow', icon: Workflow },
      [ClientToolCallState.executing]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Analyzed your workflow', icon: Workflow },
      [ClientToolCallState.error]: { text: 'Failed to analyze your workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted analyzing your workflow', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped analyzing your workflow',
        icon: MinusCircle,
      },
    },
  },
  [CopilotTool.edit_workflow_variable]: {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing workflow variable changes',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set workflow variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Editing workflow variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow variables updated', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to edit workflow variables', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review workflow variable changes', icon: Settings2 },
      [ClientToolCallState.aborted]: { text: 'Aborted editing workflow variables', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Rejected workflow variable changes',
        icon: MinusCircle,
      },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Check },
      reject: { text: 'Reject changes', icon: MinusCircle },
    },
  },
  create_workflow: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Creating workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Create workflow?', icon: Grid2x2 },
      [ClientToolCallState.executing]: { text: 'Creating workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Created workflow', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to create workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted creating workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped creating workflow', icon: MinusCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  },
  edit_workflow: {
    displayNames: {
      ...createProgressDisplayNames('Editing your workflow'),
      [ClientToolCallState.success]: { text: 'Edited your workflow', icon: Grid2x2 },
      [ClientToolCallState.error]: { text: 'Failed to edit your workflow', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted editing your workflow', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Check },
      reject: { text: 'Reject changes', icon: MinusCircle },
    },
  },
  edit_workflow_block: {
    displayNames: {
      ...createProgressDisplayNames('Editing your workflow block'),
      [ClientToolCallState.success]: { text: 'Edited your workflow block', icon: Grid2x2 },
      [ClientToolCallState.error]: { text: 'Failed to edit workflow block', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow block changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: {
        text: 'Rejected workflow block changes',
        icon: MinusCircle,
      },
      [ClientToolCallState.aborted]: { text: 'Aborted editing workflow block', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Check },
      reject: { text: 'Reject changes', icon: MinusCircle },
    },
  },
  rename_workflow: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Renaming workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Rename workflow?', icon: Grid2x2 },
      [ClientToolCallState.executing]: { text: 'Renaming workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Renamed workflow', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to rename workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted renaming workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped renaming workflow', icon: MinusCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  },
  check_deployment_status: {
    displayNames: {
      ...createProgressDisplayNames('Checking deployment status'),
      [ClientToolCallState.success]: { text: 'Checked deployment status', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to check deployment status', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted checking deployment status',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped checking deployment status',
        icon: MinusCircle,
      },
    },
  },
  list_monitors: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing monitors', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing monitors', icon: Activity },
      [ClientToolCallState.executing]: { text: 'Listing monitors', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Listed monitors', icon: Activity },
      [ClientToolCallState.error]: { text: 'Failed to list monitors', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted listing monitors', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing monitors', icon: MinusCircle },
    },
  },
  [CopilotTool.read_monitor]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading monitor document', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading monitor document', icon: FileJson },
      [ClientToolCallState.executing]: { text: 'Reading monitor document', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read monitor document', icon: FileJson },
      [ClientToolCallState.error]: { text: 'Failed to read monitor document', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted reading monitor document', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading monitor document',
        icon: MinusCircle,
      },
    },
  },
  edit_monitor: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing monitor document', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Edit monitor document?', icon: Activity },
      [ClientToolCallState.executing]: { text: 'Editing monitor document', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited monitor document', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to edit monitor document', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted editing monitor document', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped editing monitor document', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
  },
  [CopilotTool.read_block_outputs]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block outputs', icon: Tag },
      [ClientToolCallState.executing]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting outputs', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved block outputs', icon: Tag },
      [ClientToolCallState.error]: { text: 'Failed to get outputs', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting outputs', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (!Array.isArray(blockIds) || blockIds.length === 0) return undefined
      const count = blockIds.length
      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved outputs for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Getting outputs for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.error:
          return `Failed to get outputs for ${count} block${count > 1 ? 's' : ''}`
      }
      return undefined
    },
  },
  [CopilotTool.read_block_upstream_references]: {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting upstream references', icon: GitBranch },
      [ClientToolCallState.executing]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting references', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved upstream references', icon: GitBranch },
      [ClientToolCallState.error]: { text: 'Failed to get references', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting references', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (!Array.isArray(blockIds) || blockIds.length === 0) return undefined
      const count = blockIds.length
      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved references for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Getting references for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.error:
          return `Failed to get references for ${count} block${count > 1 ? 's' : ''}`
      }
      return undefined
    },
  },
  list_custom_tools: createEntityListMetadata('custom tools', Code2),
  [CopilotTool.read_custom_tool]: createEntityReadMetadata('custom tool'),
  create_custom_tool: createEntityMutationMetadata('custom tool', 'create', Code2),
  edit_custom_tool: createEntityMutationMetadata('custom tool', 'edit', Code2),
  rename_custom_tool: createEntityMutationMetadata('custom tool', 'rename', Code2),
  [CopilotTool.list_indicators]: createEntityListMetadata('indicators', BarChart3),
  [CopilotTool.read_indicator]: createEntityReadMetadata('indicator'),
  create_indicator: createEntityMutationMetadata('indicator', 'create', BarChart3),
  edit_indicator: createEntityMutationMetadata('indicator', 'edit', BarChart3),
  rename_indicator: createEntityMutationMetadata('indicator', 'rename', BarChart3),
  list_skills: createEntityListMetadata('skills', BookOpen),
  [CopilotTool.read_skill]: createEntityReadMetadata('skill'),
  create_skill: createEntityMutationMetadata('skill', 'create', BookOpen),
  edit_skill: createEntityMutationMetadata('skill', 'edit', BookOpen),
  rename_skill: createEntityMutationMetadata('skill', 'rename', BookOpen),
  list_mcp_servers: createEntityListMetadata('MCP servers', Server),
  [CopilotTool.read_mcp_server]: createEntityReadMetadata('MCP server'),
  create_mcp_server: createEntityMutationMetadata('MCP server', 'create', Server),
  edit_mcp_server: createEntityMutationMetadata('MCP server', 'edit', Server),
  rename_mcp_server: createEntityMutationMetadata('MCP server', 'rename', Server),
  list_watchlist: createEntityListMetadata('watchlists', ListChecks),
  read_watchlist: createEntityReadMetadata('watchlist'),
  create_watchlist: createEntityMutationMetadata('watchlist', 'create', ListChecks),
  edit_watchlist: createEntityMutationMetadata('watchlist', 'edit', ListChecks),
  rename_watchlist: createEntityMutationMetadata('watchlist', 'rename', ListChecks),
  list_layout: createEntityListMetadata('dashboard layouts', Grid2x2),
  create_layout: createEntityMutationMetadata('dashboard layout', 'create', Grid2x2),
  read_layout: createEntityReadMetadata('dashboard layout'),
  edit_layout: createEntityMutationMetadata('dashboard layout', 'edit', Grid2x2),
  rename_layout: createEntityMutationMetadata('dashboard layout', 'rename', Grid2x2),
  edit_widget: createEntityMutationMetadata('dashboard widget', 'edit', Blocks),
  get_available_widgets: createEntityListMetadata('dashboard widgets', Blocks),
  get_widgets_metadata: createEntityReadMetadata('dashboard widget metadata'),
  list_gdrive_files: {
    displayNames: {
      ...createProgressDisplayNames('Listing GDrive files'),
      [ClientToolCallState.success]: { text: 'Listed GDrive files', icon: FolderOpen },
      [ClientToolCallState.error]: { text: 'Failed to list GDrive files', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing GDrive files', icon: MinusCircle },
    },
  },
  read_gdrive_file: {
    displayNames: {
      ...createProgressDisplayNames('Reading Google Drive file'),
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
