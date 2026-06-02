import type { Edge } from '@xyflow/react'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getBlock } from '@/blocks'
import {
  getLocalizedDefaultBlockName,
  getWorkflowEditorCopy,
  getWorkflowLabelCopy,
  type LocaleCode,
  localizeWorkflowSubBlockConfig,
  resolveWorkflowDisplayValue,
  translateWorkflowLabel,
} from '@/i18n/block-editor'
import type { PublicCopy } from '@/i18n/public-copy'
import type {
  BlockData,
  BlockState,
  Loop,
  Position,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'
import {
  adaptPreviewPayloadToCanvas,
  type PreviewPayloadAdapterResult,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-payload-adapter'
import { buildPreviewSummaryRows } from '@/widgets/widgets/editor_workflow/components/workflow-render/preview-summary'

export interface WorkflowPreviewDemo {
  id: string
  name: string
  color: string
  previewPayload: PreviewPayloadAdapterResult
}

type WorkflowPreviewDemoCopy = PublicCopy['landing']['preview']['workflow']['demoCopy']

type ParentConfig = {
  parentId?: string
  extent?: 'parent'
}

type BaseBlockConfig = {
  id: string
  type: string
  name: string
  position: Position
  subBlocks?: Record<string, SubBlockState>
  height?: number
  horizontalHandles?: boolean
  data?: BlockData
} & ParentConfig

type AgentBlockConfig = {
  id: string
  name: string
  position: Position
  systemPrompt: string
  userPrompt: string
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  height?: number
} & ParentConfig

type LoopBlockConfig = {
  id: string
  name: string
  position: Position
  size: { width: number; height: number }
}

const createSubBlock = (
  id: string,
  type: SubBlockState['type'],
  value: SubBlockState['value']
): SubBlockState => ({
  id,
  type,
  value,
})

const createBlock = ({
  id,
  type,
  name,
  position,
  subBlocks = {},
  height,
  horizontalHandles = true,
  data,
  parentId,
  extent,
}: BaseBlockConfig): BlockState => ({
  id,
  type,
  name,
  position,
  subBlocks,
  outputs: {},
  enabled: true,
  horizontalHandles,
  ...(typeof height === 'number' ? { height } : {}),
  ...(parentId || data
    ? {
        data: {
          ...(data ?? {}),
          ...(parentId ? { parentId, extent: extent ?? 'parent' } : {}),
        },
      }
    : {}),
})

const createAgentBlock = ({
  id,
  name,
  position,
  systemPrompt,
  userPrompt,
  model = 'gpt-5.4-mini',
  reasoningEffort = 'medium',
  verbosity = 'medium',
  height = 232,
  parentId,
  extent,
}: AgentBlockConfig): BlockState =>
  createBlock({
    id,
    type: 'agent',
    name,
    position,
    height,
    parentId,
    extent,
    subBlocks: {
      systemPrompt: createSubBlock('systemPrompt', 'long-input', systemPrompt),
      userPrompt: createSubBlock('userPrompt', 'long-input', userPrompt),
      model: createSubBlock('model', 'combobox', model),
      reasoningEffort: createSubBlock('reasoningEffort', 'dropdown', reasoningEffort),
      verbosity: createSubBlock('verbosity', 'dropdown', verbosity),
    },
  })

const createLoopBlock = ({ id, name, position, size }: LoopBlockConfig): BlockState =>
  createBlock({
    id,
    type: 'loop',
    name,
    position,
    data: {
      type: 'loop',
      width: size.width,
      height: size.height,
    },
  })

const createEdge = ({
  id,
  source,
  target,
  sourceHandle = 'source',
  targetHandle = 'target',
}: {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  type: 'workflowEdge',
})

const createHistoricalDataBlock = ({
  id,
  name,
  position,
  listing = 'NVDA',
}: {
  id: string
  name: string
  position: Position
  listing?: string
}): BlockState =>
  createBlock({
    id,
    type: 'historical_data',
    name,
    position,
    height: 168,
    subBlocks: {
      provider: createSubBlock('provider', 'dropdown', 'polygon'),
      listing: createSubBlock('listing', 'market-selector', listing),
      interval: createSubBlock('interval', 'dropdown', '1d'),
    },
  })

const createSearchBlock = ({
  id,
  name,
  position,
  query,
}: {
  id: string
  name: string
  position: Position
  query: string
}): BlockState =>
  createBlock({
    id,
    type: 'search',
    name,
    position,
    height: 152,
    subBlocks: {
      query: createSubBlock('query', 'long-input', query),
    },
  })

const createFunctionBlock = ({
  id,
  name,
  position,
  code,
}: {
  id: string
  name: string
  position: Position
  code: string
}): BlockState =>
  createBlock({
    id,
    type: 'function',
    name,
    position,
    height: 156,
    subBlocks: {
      code: createSubBlock('code', 'code', code),
    },
  })

const createTradingActionBlock = ({
  id,
  name,
  position,
  side,
  listing = 'NVDA',
}: {
  id: string
  name: string
  position: Position
  side: 'buy' | 'sell'
  listing?: string
}): BlockState =>
  createBlock({
    id,
    type: 'trading_action',
    name,
    position,
    height: 188,
    subBlocks: {
      provider: createSubBlock('provider', 'dropdown', 'alpaca'),
      environment: createSubBlock('environment', 'dropdown', 'paper'),
      side: createSubBlock('side', 'dropdown', side),
      listing: createSubBlock('listing', 'market-selector', listing),
      orderType: createSubBlock('orderType', 'dropdown', 'market'),
      timeInForce: createSubBlock('timeInForce', 'dropdown', 'day'),
    },
  })

const createSlackBlock = ({
  id,
  name,
  position,
  channel,
  text,
}: {
  id: string
  name: string
  position: Position
  channel: string
  text: string
}): BlockState =>
  createBlock({
    id,
    type: 'slack',
    name,
    position,
    height: 212,
    subBlocks: {
      operation: createSubBlock('operation', 'dropdown', 'send'),
      authMethod: createSubBlock('authMethod', 'dropdown', 'oauth'),
      credential: createSubBlock('credential', 'oauth-input', 'Trading Desk Workspace'),
      channel: createSubBlock('channel', 'channel-selector', channel),
      text: createSubBlock('text', 'long-input', text),
    },
  })

const createNotionBlock = ({
  id,
  name,
  position,
  title,
  content,
}: {
  id: string
  name: string
  position: Position
  title: string
  content: string
}): BlockState =>
  createBlock({
    id,
    type: 'notion',
    name,
    position,
    height: 212,
    subBlocks: {
      operation: createSubBlock('operation', 'dropdown', 'notion_create_page'),
      credential: createSubBlock('credential', 'oauth-input', 'Research Workspace'),
      parentId: createSubBlock('parentId', 'short-input', 'investment-committee'),
      title: createSubBlock('title', 'short-input', title),
      content: createSubBlock('content', 'long-input', content),
    },
  })

const createWebhookBlock = ({
  id,
  name,
  position,
  url,
  body,
}: {
  id: string
  name: string
  position: Position
  url: string
  body: Record<string, unknown>
}): BlockState =>
  createBlock({
    id,
    type: 'webhook_request',
    name,
    position,
    height: 188,
    subBlocks: {
      url: createSubBlock('url', 'short-input', url),
      body: createSubBlock('body', 'code', JSON.stringify(body, null, 2)),
    },
  })

const createConditionBlock = ({
  id,
  name,
  position,
  conditions,
}: {
  id: string
  name: string
  position: Position
  conditions: Array<{ id: string; value: string }>
}): BlockState =>
  createBlock({
    id,
    type: 'condition',
    name,
    position,
    height: 172,
    subBlocks: {
      conditions: createSubBlock('conditions', 'condition-input', JSON.stringify(conditions)),
    },
  })

const localizeDefaultName = (locale: LocaleCode, type: string) =>
  getLocalizedDefaultBlockName(locale, type)

const localizeCustomName = (locale: LocaleCode, key: string) => translateWorkflowLabel(locale, key)

function buildLocalizedPreviewPayload(
  locale: LocaleCode,
  workflowState: WorkflowState
): PreviewPayloadAdapterResult {
  const workflowEditorCopy = getWorkflowEditorCopy(locale)
  const workflowLabelsCopy = getWorkflowLabelCopy(locale)
  const previewPayload = adaptPreviewPayloadToCanvas(workflowState, { includeConfig: false })

  return {
    nodes: previewPayload.nodes.map((node) => {
      if (node.type === 'subflowNode') {
        return {
          ...node,
          data: {
            ...node.data,
            title: getLocalizedDefaultBlockName(locale, node.data.kind, node.data.name),
            startLabel: workflowEditorCopy.start,
            endLabel: workflowEditorCopy.end,
          },
        }
      }

      const blockConfig = getBlock(node.data.type)
      if (!blockConfig) {
        return node
      }

      const previewStateRaw = node.data.subBlockValues ?? node.data.blockState?.subBlocks ?? {}
      const triggerId = resolveTriggerIdFromSubBlocks(
        previewStateRaw,
        blockConfig.triggers?.available
      )
      const localizedSubBlocks = (blockConfig.subBlocks || []).map((subBlock) =>
        localizeWorkflowSubBlockConfig(locale, subBlock, node.data.type, triggerId ?? undefined)
      )
      const isPureTriggerBlock = blockConfig.category === 'triggers'
      const isTriggerMode = Boolean(node.data.blockState?.triggerMode) || isPureTriggerBlock
      const previewSubBlocks = buildSubBlockRows({
        blockId: node.id,
        subBlocks: localizedSubBlocks,
        stateToUse: previewStateRaw,
        isAdvancedMode: Boolean(node.data.blockState?.advancedMode),
        isTriggerMode,
        isPureTriggerBlock,
        availableTriggerIds: blockConfig.triggers?.available,
        hideFromPreview: true,
        triggerSubBlockOwner: 'all',
      }).flat()

      return {
        ...node,
        data: {
          type: node.data.type,
          name: node.data.name,
          readOnly: true,
          isPreview: true,
          diffStatus: node.data.diffStatus,
          title: getLocalizedDefaultBlockName(locale, node.data.type, node.data.name),
          summaryRows: buildPreviewSummaryRows({
            blockId: node.id,
            subBlocks: previewSubBlocks,
            stateToUse: previewStateRaw,
            showErrorRow: blockConfig.category !== 'triggers',
            availableTriggerIds: blockConfig.triggers?.available,
            labels: workflowLabelsCopy,
            objectItemLabel: workflowEditorCopy.summary.objectItem,
            additionalCountTemplate: workflowEditorCopy.summary.additionalCount,
            blockType: node.data.type,
            resolveDisplayValue: (config, value, blockType) =>
              resolveWorkflowDisplayValue(locale, config, value, blockType),
          }),
          objectItemLabel: workflowEditorCopy.summary.objectItem,
          enabled: node.data.blockState?.enabled ?? true,
          horizontalHandles: node.data.blockState?.horizontalHandles ?? false,
        },
      }
    }),
    edges: previewPayload.edges,
  }
}

function buildAnalystCoverageState(
  locale: LocaleCode,
  copy: WorkflowPreviewDemoCopy['signalBriefing']
): WorkflowState {
  return {
    blocks: {
      trigger: createBlock({
        id: 'trigger',
        type: 'indicator_trigger',
        name: localizeCustomName(locale, 'indicatorMonitor'),
        position: { x: 150, y: 234 },
        height: 132,
        subBlocks: {
          triggerInstructions: createSubBlock(
            'triggerInstructions',
            'text',
            copy.triggerInstructions
          ),
        },
      }),
      marketData: createHistoricalDataBlock({
        id: 'marketData',
        name: localizeDefaultName(locale, 'historical_data'),
        position: { x: 505, y: 216 },
        listing: 'NVDA',
      }),
      signalLogic: createFunctionBlock({
        id: 'signalLogic',
        name: localizeDefaultName(locale, 'function'),
        position: { x: 860, y: 222 },
        code: "return { bias: 'long', confidence: 0.74, timeframe: 'swing' }",
      }),
      headlineSearch: createSearchBlock({
        id: 'headlineSearch',
        name: localizeDefaultName(locale, 'search'),
        position: { x: 1215, y: 224 },
        query: copy.headlineQuery,
      }),
      marketAnalyst: createAgentBlock({
        id: 'marketAnalyst',
        name: localizeCustomName(locale, 'marketAnalyst'),
        position: { x: 1570, y: 184 },
        systemPrompt: copy.marketAnalystSystemPrompt,
        userPrompt: copy.marketAnalystUserPrompt,
        reasoningEffort: 'high',
        verbosity: 'low',
      }),
      slack: createSlackBlock({
        id: 'slack',
        name: localizeDefaultName(locale, 'slack'),
        position: { x: 1925, y: 194 },
        channel: '#trading-desk',
        text: copy.slackText,
      }),
    },
    edges: [
      createEdge({ id: 'trigger-market-data', source: 'trigger', target: 'marketData' }),
      createEdge({ id: 'market-data-signal-logic', source: 'marketData', target: 'signalLogic' }),
      createEdge({
        id: 'signal-logic-headline-search',
        source: 'signalLogic',
        target: 'headlineSearch',
      }),
      createEdge({
        id: 'headline-search-market-analyst',
        source: 'headlineSearch',
        target: 'marketAnalyst',
      }),
      createEdge({
        id: 'market-analyst-slack',
        source: 'marketAnalyst',
        target: 'slack',
      }),
    ],
    loops: {},
    parallels: {},
  }
}

const INVESTMENT_DEBATE_LOOP: Loop = {
  id: 'investmentDebate',
  nodes: ['bullResearcher', 'bearResearcher'],
  iterations: 2,
  loopType: 'for',
}

function buildInvestmentDebateState(
  locale: LocaleCode,
  copy: WorkflowPreviewDemoCopy['investmentDebate']
): WorkflowState {
  return {
    blocks: {
      ideaIntake: createBlock({
        id: 'ideaIntake',
        type: 'input_trigger',
        name: localizeDefaultName(locale, 'input_trigger'),
        position: { x: 150, y: 224 },
        height: 152,
        subBlocks: {
          inputFormat: createSubBlock('inputFormat', 'input-format', [
            ['listing', 'listing', 'string', 'NVDA'],
            ['thesis', 'thesis', 'string', copy.inputThesis],
          ]),
        },
      }),
      catalystSearch: createSearchBlock({
        id: 'catalystSearch',
        name: localizeDefaultName(locale, 'search'),
        position: { x: 505, y: 224 },
        query: copy.catalystQuery,
      }),
      analystDossier: createAgentBlock({
        id: 'analystDossier',
        name: localizeCustomName(locale, 'analystDossier'),
        position: { x: 860, y: 191 },
        systemPrompt: copy.analystDossierSystemPrompt,
        userPrompt: copy.analystDossierUserPrompt,
        height: 218,
        reasoningEffort: 'medium',
        verbosity: 'low',
      }),
      investmentDebate: createLoopBlock({
        id: 'investmentDebate',
        name: localizeCustomName(locale, 'bullVsBearDebate'),
        position: { x: 1215, y: 150 },
        size: { width: 951.75, height: 741 },
      }),
      bullResearcher: createAgentBlock({
        id: 'bullResearcher',
        name: localizeCustomName(locale, 'bullResearcher'),
        position: { x: 180, y: 100 },
        parentId: 'investmentDebate',
        systemPrompt: copy.bullResearcherSystemPrompt,
        userPrompt: copy.bullResearcherUserPrompt,
        height: 218,
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      bearResearcher: createAgentBlock({
        id: 'bearResearcher',
        name: localizeCustomName(locale, 'bearResearcher'),
        position: { x: 481.75, y: 323 },
        parentId: 'investmentDebate',
        systemPrompt: copy.bearResearcherSystemPrompt,
        userPrompt: copy.bearResearcherUserPrompt,
        height: 218,
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      researchManager: createAgentBlock({
        id: 'researchManager',
        name: localizeCustomName(locale, 'researchManager'),
        position: { x: 2171.75, y: 187 },
        systemPrompt: copy.researchManagerSystemPrompt,
        userPrompt: copy.researchManagerUserPrompt,
        height: 226,
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      notion: createNotionBlock({
        id: 'notion',
        name: localizeDefaultName(locale, 'notion'),
        position: { x: 2526.75, y: 194 },
        title: copy.notionTitle,
        content: copy.notionContent,
      }),
    },
    edges: [
      createEdge({
        id: 'idea-intake-catalyst-search',
        source: 'ideaIntake',
        target: 'catalystSearch',
      }),
      createEdge({
        id: 'catalyst-search-analyst-dossier',
        source: 'catalystSearch',
        target: 'analystDossier',
      }),
      createEdge({
        id: 'analyst-dossier-investment-debate',
        source: 'analystDossier',
        target: 'investmentDebate',
        targetHandle: 'target',
      }),
      createEdge({
        id: 'investment-debate-start-bull',
        source: 'investmentDebate',
        sourceHandle: 'loop-start-source',
        target: 'bullResearcher',
      }),
      createEdge({
        id: 'bull-researcher-bear-researcher',
        source: 'bullResearcher',
        target: 'bearResearcher',
      }),
      createEdge({
        id: 'bear-researcher-investment-debate-end',
        source: 'bearResearcher',
        target: 'investmentDebate',
        targetHandle: 'loop-end-target',
      }),
      createEdge({
        id: 'investment-debate-research-manager',
        source: 'investmentDebate',
        sourceHandle: 'loop-end-source',
        target: 'researchManager',
      }),
      createEdge({
        id: 'research-manager-notion',
        source: 'researchManager',
        target: 'notion',
      }),
    ],
    loops: {
      investmentDebate: INVESTMENT_DEBATE_LOOP,
    },
    parallels: {},
  }
}

const RISK_COMMITTEE_LOOP: Loop = {
  id: 'riskCommittee',
  nodes: ['aggressiveAnalyst', 'conservativeAnalyst', 'neutralAnalyst'],
  iterations: 3,
  loopType: 'for',
}

function buildRiskRoutingState(
  locale: LocaleCode,
  copy: WorkflowPreviewDemoCopy['riskRouting']
): WorkflowState {
  return {
    blocks: {
      newsFeed: createBlock({
        id: 'newsFeed',
        type: 'rss',
        name: localizeDefaultName(locale, 'rss'),
        position: { x: 150, y: 228 },
        height: 144,
        subBlocks: {
          feedUrl: createSubBlock(
            'feedUrl',
            'short-input',
            'https://feeds.reuters.com/reuters/businessNews'
          ),
        },
      }),
      headlineSearch: createSearchBlock({
        id: 'headlineSearch',
        name: localizeDefaultName(locale, 'search'),
        position: { x: 505, y: 224 },
        query: copy.headlineQuery,
      }),
      traderProposal: createAgentBlock({
        id: 'traderProposal',
        name: localizeCustomName(locale, 'traderProposal'),
        position: { x: 860, y: 191 },
        systemPrompt: copy.traderProposalSystemPrompt,
        userPrompt: copy.traderProposalUserPrompt,
        height: 218,
        reasoningEffort: 'medium',
        verbosity: 'low',
      }),
      riskCommittee: createLoopBlock({
        id: 'riskCommittee',
        name: localizeCustomName(locale, 'riskCommittee'),
        position: { x: 1215, y: 150 },
        size: { width: 1253.5, height: 952 },
      }),
      aggressiveAnalyst: createAgentBlock({
        id: 'aggressiveAnalyst',
        name: localizeCustomName(locale, 'aggressiveAnalyst'),
        position: { x: 180, y: 100 },
        parentId: 'riskCommittee',
        systemPrompt: copy.aggressiveAnalystSystemPrompt,
        userPrompt: copy.aggressiveAnalystUserPrompt,
        height: 214,
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      conservativeAnalyst: createAgentBlock({
        id: 'conservativeAnalyst',
        name: localizeCustomName(locale, 'conservativeAnalyst'),
        position: { x: 481.75, y: 319 },
        parentId: 'riskCommittee',
        systemPrompt: copy.conservativeAnalystSystemPrompt,
        userPrompt: copy.conservativeAnalystUserPrompt,
        height: 214,
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      neutralAnalyst: createAgentBlock({
        id: 'neutralAnalyst',
        name: localizeCustomName(locale, 'neutralAnalyst'),
        position: { x: 783.5, y: 538 },
        parentId: 'riskCommittee',
        systemPrompt: copy.neutralAnalystSystemPrompt,
        userPrompt: copy.neutralAnalystUserPrompt,
        height: 214,
        reasoningEffort: 'medium',
        verbosity: 'medium',
      }),
      portfolioManager: createAgentBlock({
        id: 'portfolioManager',
        name: localizeCustomName(locale, 'portfolioManager'),
        position: { x: 2473.5, y: 187 },
        systemPrompt: copy.portfolioManagerSystemPrompt,
        userPrompt: copy.portfolioManagerUserPrompt,
        height: 226,
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        verbosity: 'medium',
      }),
      decisionRouter: createConditionBlock({
        id: 'decisionRouter',
        name: localizeCustomName(locale, 'decisionRouter'),
        position: { x: 2828.5, y: 214 },
        conditions: [
          {
            id: 'increase',
            value: 'rating === "Buy" || rating === "Overweight"',
          },
          {
            id: 'hold',
            value: 'rating === "Hold"',
          },
          {
            id: 'reduce',
            value: 'rating === "Underweight" || rating === "Sell"',
          },
        ],
      }),
      increasePosition: createTradingActionBlock({
        id: 'increasePosition',
        name: localizeCustomName(locale, 'increasePosition'),
        position: { x: 3183.5, y: 150 },
        side: 'buy',
        listing: 'NVDA',
      }),
      webhook: createWebhookBlock({
        id: 'webhook',
        name: localizeDefaultName(locale, 'webhook_request'),
        position: { x: 3183.5, y: 343 },
        url: 'https://ops.example.com/risk-routing',
        body: {
          route: 'hold',
          destination: 'watchlist',
          note: copy.webhookNote,
        },
      }),
      reduceExposure: createTradingActionBlock({
        id: 'reduceExposure',
        name: localizeCustomName(locale, 'reduceExposure'),
        position: { x: 3183.5, y: 536 },
        side: 'sell',
        listing: 'NVDA',
      }),
    },
    edges: [
      createEdge({
        id: 'news-feed-headline-search',
        source: 'newsFeed',
        target: 'headlineSearch',
      }),
      createEdge({
        id: 'headline-search-trader-proposal',
        source: 'headlineSearch',
        target: 'traderProposal',
      }),
      createEdge({
        id: 'trader-proposal-risk-committee',
        source: 'traderProposal',
        target: 'riskCommittee',
        targetHandle: 'target',
      }),
      createEdge({
        id: 'risk-committee-start-aggressive',
        source: 'riskCommittee',
        sourceHandle: 'loop-start-source',
        target: 'aggressiveAnalyst',
      }),
      createEdge({
        id: 'aggressive-analyst-conservative-analyst',
        source: 'aggressiveAnalyst',
        target: 'conservativeAnalyst',
      }),
      createEdge({
        id: 'conservative-analyst-neutral-analyst',
        source: 'conservativeAnalyst',
        target: 'neutralAnalyst',
      }),
      createEdge({
        id: 'neutral-analyst-risk-committee-end',
        source: 'neutralAnalyst',
        target: 'riskCommittee',
        targetHandle: 'loop-end-target',
      }),
      createEdge({
        id: 'risk-committee-portfolio-manager',
        source: 'riskCommittee',
        sourceHandle: 'loop-end-source',
        target: 'portfolioManager',
      }),
      createEdge({
        id: 'portfolio-manager-decision-router',
        source: 'portfolioManager',
        target: 'decisionRouter',
      }),
      createEdge({
        id: 'decision-router-increase-position',
        source: 'decisionRouter',
        sourceHandle: 'condition-increase',
        target: 'increasePosition',
      }),
      createEdge({
        id: 'decision-router-webhook',
        source: 'decisionRouter',
        sourceHandle: 'condition-hold',
        target: 'webhook',
      }),
      createEdge({
        id: 'decision-router-reduce-exposure',
        source: 'decisionRouter',
        sourceHandle: 'condition-reduce',
        target: 'reduceExposure',
      }),
    ],
    loops: {
      riskCommittee: RISK_COMMITTEE_LOOP,
    },
    parallels: {},
  }
}

export function buildTradingAgentWorkflowDemos(
  locale: LocaleCode,
  copy: WorkflowPreviewDemoCopy
): WorkflowPreviewDemo[] {
  return [
    {
      id: 'analyst-coverage',
      name: localizeCustomName(locale, 'signalBriefing'),
      color: '#0f766e',
      previewPayload: buildLocalizedPreviewPayload(
        locale,
        buildAnalystCoverageState(locale, copy.signalBriefing)
      ),
    },
    {
      id: 'investment-debate',
      name: localizeCustomName(locale, 'investmentDebate'),
      color: '#2563eb',
      previewPayload: buildLocalizedPreviewPayload(
        locale,
        buildInvestmentDebateState(locale, copy.investmentDebate)
      ),
    },
    {
      id: 'risk-routing',
      name: localizeCustomName(locale, 'riskRouting'),
      color: '#dc2626',
      previewPayload: buildLocalizedPreviewPayload(
        locale,
        buildRiskRoutingState(locale, copy.riskRouting)
      ),
    },
  ]
}
