import type { Edge } from '@xyflow/react'
import type {
  BlockData,
  BlockState,
  Loop,
  Position,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'

export interface WorkflowPreviewDemo {
  id: string
  name: string
  color: string
  workflowState: WorkflowState
}

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

const ANALYST_COVERAGE_STATE: WorkflowState = {
  blocks: {
    trigger: createBlock({
      id: 'trigger',
      type: 'indicator_trigger',
      name: 'Indicator Monitor',
      position: { x: 150, y: 234 },
      height: 132,
      subBlocks: {
        triggerInstructions: createSubBlock(
          'triggerInstructions',
          'text',
          'Monitor-driven entry signal for NVDA momentum and trend shifts.'
        ),
      },
    }),
    marketData: createHistoricalDataBlock({
      id: 'marketData',
      name: 'Historical Data',
      position: { x: 505, y: 216 },
      listing: 'NVDA',
    }),
    signalLogic: createFunctionBlock({
      id: 'signalLogic',
      name: 'Function',
      position: { x: 860, y: 222 },
      code: "return { bias: 'long', confidence: 0.74, timeframe: 'swing' }",
    }),
    headlineSearch: createSearchBlock({
      id: 'headlineSearch',
      name: 'Search',
      position: { x: 1215, y: 224 },
      query: 'NVDA earnings guidance, AI demand, and near-term volatility catalysts',
    }),
    marketAnalyst: createAgentBlock({
      id: 'marketAnalyst',
      name: 'Market Analyst',
      position: { x: 1570, y: 184 },
      systemPrompt:
        'Use the price series, computed signal, and headline scan to prepare a concise trading brief.',
      userPrompt: 'Summarize the setup, conviction, and invalidation for NVDA.',
      reasoningEffort: 'high',
      verbosity: 'low',
    }),
    slack: createSlackBlock({
      id: 'slack',
      name: 'Slack',
      position: { x: 1925, y: 194 },
      channel: '#trading-desk',
      text: 'Post the final signal brief with bias, confidence, and risk levels.',
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

const INVESTMENT_DEBATE_LOOP: Loop = {
  id: 'investmentDebate',
  nodes: ['bullResearcher', 'bearResearcher'],
  iterations: 2,
  loopType: 'for',
}

const INVESTMENT_DEBATE_STATE: WorkflowState = {
  blocks: {
    ideaIntake: createBlock({
      id: 'ideaIntake',
      type: 'input_trigger',
      name: 'Input Form',
      position: { x: 150, y: 224 },
      height: 152,
      subBlocks: {
        inputFormat: createSubBlock('inputFormat', 'input-format', [
          ['listing', 'listing', 'string', 'NVDA'],
          ['thesis', 'thesis', 'string', 'AI demand remains strong'],
        ]),
      },
    }),
    catalystSearch: createSearchBlock({
      id: 'catalystSearch',
      name: 'Search',
      position: { x: 505, y: 224 },
      query: 'Recent NVDA catalysts, guidance changes, and analyst revisions',
    }),
    analystDossier: createAgentBlock({
      id: 'analystDossier',
      name: 'Analyst Dossier',
      position: { x: 860, y: 191 },
      systemPrompt:
        'Package the intake thesis and fresh catalyst search into a concise debate-ready briefing.',
      userPrompt: 'Prepare the combined research dossier for the investment committee.',
      height: 218,
      reasoningEffort: 'medium',
      verbosity: 'low',
    }),
    investmentDebate: createLoopBlock({
      id: 'investmentDebate',
      name: 'Bull vs Bear Debate',
      position: { x: 1215, y: 150 },
      size: { width: 951.75, height: 741 },
    }),
    bullResearcher: createAgentBlock({
      id: 'bullResearcher',
      name: 'Bull Researcher',
      position: { x: 180, y: 100 },
      parentId: 'investmentDebate',
      systemPrompt:
        'Build the strongest growth case, defend upside, and directly rebut the bearish view with evidence.',
      userPrompt: 'Argue why the stock deserves exposure based on the analyst reports.',
      height: 218,
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    bearResearcher: createAgentBlock({
      id: 'bearResearcher',
      name: 'Bear Researcher',
      position: { x: 481.75, y: 323 },
      parentId: 'investmentDebate',
      systemPrompt:
        'Challenge the long thesis, emphasize downside risk, and expose weak assumptions in the bull case.',
      userPrompt: 'Argue why the stock should be avoided or reduced based on the same reports.',
      height: 218,
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    researchManager: createAgentBlock({
      id: 'researchManager',
      name: 'Research Manager',
      position: { x: 2171.75, y: 187 },
      systemPrompt:
        'Judge the debate, commit to Buy, Sell, or Hold, and hand a concrete investment plan to the trader.',
      userPrompt: 'Summarize the strongest arguments and decide the investment plan.',
      height: 226,
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    notion: createNotionBlock({
      id: 'notion',
      name: 'Notion',
      position: { x: 2526.75, y: 194 },
      title: 'Investment committee memo',
      content: 'Write the final committee decision, strongest arguments, and next action.',
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

const RISK_COMMITTEE_LOOP: Loop = {
  id: 'riskCommittee',
  nodes: ['aggressiveAnalyst', 'conservativeAnalyst', 'neutralAnalyst'],
  iterations: 3,
  loopType: 'for',
}

const RISK_ROUTING_STATE: WorkflowState = {
  blocks: {
    newsFeed: createBlock({
      id: 'newsFeed',
      type: 'rss',
      name: 'RSS Feed',
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
      name: 'Search',
      position: { x: 505, y: 224 },
      query: 'Latest NVDA risk headlines, regulation changes, and volatility catalysts',
    }),
    traderProposal: createAgentBlock({
      id: 'traderProposal',
      name: 'Trader Proposal',
      position: { x: 860, y: 191 },
      systemPrompt:
        'Frame the proposed position, sizing logic, and thesis using the feed event plus the latest headline search.',
      userPrompt: 'Submit the trade proposal for committee review.',
      height: 218,
      reasoningEffort: 'medium',
      verbosity: 'low',
    }),
    riskCommittee: createLoopBlock({
      id: 'riskCommittee',
      name: 'Risk Committee',
      position: { x: 1215, y: 150 },
      size: { width: 1253.5, height: 952 },
    }),
    aggressiveAnalyst: createAgentBlock({
      id: 'aggressiveAnalyst',
      name: 'Aggressive Analyst',
      position: { x: 180, y: 100 },
      parentId: 'riskCommittee',
      systemPrompt:
        'Push for upside, challenge excessive caution, and defend bold positioning when reward justifies it.',
      userPrompt: 'Argue for leaning into the trade if the upside remains compelling.',
      height: 214,
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    conservativeAnalyst: createAgentBlock({
      id: 'conservativeAnalyst',
      name: 'Conservative Analyst',
      position: { x: 481.75, y: 319 },
      parentId: 'riskCommittee',
      systemPrompt:
        'Stress-test the proposal for drawdown, volatility, and capital preservation concerns.',
      userPrompt: 'Challenge the proposal with the strongest downside and stability arguments.',
      height: 214,
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    neutralAnalyst: createAgentBlock({
      id: 'neutralAnalyst',
      name: 'Neutral Analyst',
      position: { x: 783.5, y: 538 },
      parentId: 'riskCommittee',
      systemPrompt:
        'Balance upside and downside, reconcile opposing risk views, and push toward a measured stance.',
      userPrompt: 'Recommend the middle path if the evidence supports it.',
      height: 214,
      reasoningEffort: 'medium',
      verbosity: 'medium',
    }),
    portfolioManager: createAgentBlock({
      id: 'portfolioManager',
      name: 'Portfolio Manager',
      position: { x: 2473.5, y: 187 },
      systemPrompt:
        'Choose one rating from Buy, Overweight, Hold, Underweight, or Sell and define the action plan.',
      userPrompt: 'Finalize the trade rating from the full risk debate.',
      height: 226,
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      verbosity: 'medium',
    }),
    decisionRouter: createConditionBlock({
      id: 'decisionRouter',
      name: 'Decision Router',
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
      name: 'Increase Position',
      position: { x: 3183.5, y: 150 },
      side: 'buy',
      listing: 'NVDA',
    }),
    webhook: createWebhookBlock({
      id: 'webhook',
      name: 'Webhook',
      position: { x: 3183.5, y: 343 },
      url: 'https://ops.example.com/risk-routing',
      body: {
        route: 'hold',
        destination: 'watchlist',
        note: 'Send the hold decision to the downstream risk system.',
      },
    }),
    reduceExposure: createTradingActionBlock({
      id: 'reduceExposure',
      name: 'Reduce Exposure',
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

export const TRADING_AGENT_WORKFLOW_DEMOS: WorkflowPreviewDemo[] = [
  {
    id: 'analyst-coverage',
    name: 'Signal Briefing',
    color: '#0f766e',
    workflowState: ANALYST_COVERAGE_STATE,
  },
  {
    id: 'investment-debate',
    name: 'Investment Debate',
    color: '#2563eb',
    workflowState: INVESTMENT_DEBATE_STATE,
  },
  {
    id: 'risk-routing',
    name: 'Risk Routing',
    color: '#dc2626',
    workflowState: RISK_ROUTING_STATE,
  },
]
