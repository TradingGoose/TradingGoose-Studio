import { AgentBlock } from '@/blocks/blocks/agent'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock } from '@/blocks/blocks/confluence'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock } from '@/blocks/blocks/exa'
import { FileBlock } from '@/blocks/blocks/file'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GitHubBlock } from '@/blocks/blocks/github'
import { GmailBlock } from '@/blocks/blocks/gmail'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleCalendarBlock } from '@/blocks/blocks/google_calendar'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock } from '@/blocks/blocks/google_form'
import { GoogleSheetsBlock } from '@/blocks/blocks/google_sheets'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HistoricalDataBlock } from '@/blocks/blocks/historical_data'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'
import { HunterBlock } from '@/blocks/blocks/hunter'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { IndicatorTriggerBlock } from '@/blocks/blocks/indicator_trigger'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LinearBlock } from '@/blocks/blocks/linear'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftExcelBlock } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import { MistralParseBlock } from '@/blocks/blocks/mistral_parse'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { MySQLBlock } from '@/blocks/blocks/mysql'
import { NotionBlock } from '@/blocks/blocks/notion'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import { OpenAIBlock } from '@/blocks/blocks/openai'
import { OutlookBlock } from '@/blocks/blocks/outlook'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import { PineconeBlock } from '@/blocks/blocks/pinecone'
import { PostgreSQLBlock } from '@/blocks/blocks/postgresql'
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { RedditBlock } from '@/blocks/blocks/reddit'
import { ResendBlock } from '@/blocks/blocks/resend'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock } from '@/blocks/blocks/router'
import { S3Block } from '@/blocks/blocks/s3'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SerperBlock } from '@/blocks/blocks/serper'
import { SharepointBlock } from '@/blocks/blocks/sharepoint'
import { SlackBlock } from '@/blocks/blocks/slack'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StagehandAgentBlock } from '@/blocks/blocks/stagehand_agent'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TradingActionBlock } from '@/blocks/blocks/trading_action'
import { TradingHoldingsBlock } from '@/blocks/blocks/trading_holdings'
import { TradingOrderDetailBlock } from '@/blocks/blocks/trading_order_detail'
import { TradingOrderHistoryBlock } from '@/blocks/blocks/trading_order_history'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VisionBlock } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { WebflowBlock } from '@/blocks/blocks/webflow'
import { WebhookBlock } from '@/blocks/blocks/webhook'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock } from '@/blocks/blocks/wikipedia'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { XBlock } from '@/blocks/blocks/x'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import { ZepBlock } from '@/blocks/blocks/zep'
import { AhrefsBlock } from '@/blocks/blocks/ahrefs'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import { AsanaBlock } from '@/blocks/blocks/asana'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import { CirclebackBlock } from '@/blocks/blocks/circleback'
import { CursorBlock } from '@/blocks/blocks/cursor'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { DropboxBlock } from '@/blocks/blocks/dropbox'
import { DuckDuckGoBlock } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { FirefliesBlock } from '@/blocks/blocks/fireflies'
import { GitLabBlock } from '@/blocks/blocks/gitlab'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'
import { GoogleSlidesBlock } from '@/blocks/blocks/google_slides'
import { GrafanaBlock } from '@/blocks/blocks/grafana'
import { GrainBlock } from '@/blocks/blocks/grain'
import { GreptileBlock } from '@/blocks/blocks/greptile'
import { HubSpotBlock } from '@/blocks/blocks/hubspot'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { ImapBlock } from '@/blocks/blocks/imap'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { IntercomBlock } from '@/blocks/blocks/intercom'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import { KalshiBlock } from '@/blocks/blocks/kalshi'
import { LinkedInBlock } from '@/blocks/blocks/linkedin'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { MailgunBlock } from '@/blocks/blocks/mailgun'
import { Neo4jBlock } from '@/blocks/blocks/neo4j'
import { NoteBlock } from '@/blocks/blocks/note'
import { PipedriveBlock } from '@/blocks/blocks/pipedrive'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { PostHogBlock } from '@/blocks/blocks/posthog'
import { RDSBlock } from '@/blocks/blocks/rds'
import { RssBlock } from '@/blocks/blocks/rss'
import { SalesforceBlock } from '@/blocks/blocks/salesforce'
import { SearchBlock } from '@/blocks/blocks/search'
import { SendGridBlock } from '@/blocks/blocks/sendgrid'
import { SentryBlock } from '@/blocks/blocks/sentry'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { ShopifyBlock } from '@/blocks/blocks/shopify'
import { SftpBlock } from '@/blocks/blocks/sftp'
import { SmtpBlock } from '@/blocks/blocks/smtp'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import { SQSBlock } from '@/blocks/blocks/sqs'
import { SSHBlock } from '@/blocks/blocks/ssh'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { SttBlock } from '@/blocks/blocks/stt'
import { TrelloBlock } from '@/blocks/blocks/trello'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { VideoGeneratorBlock } from '@/blocks/blocks/video_generator'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WordPressBlock } from '@/blocks/blocks/wordpress'
import { ZendeskBlock } from '@/blocks/blocks/zendesk'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import type { BlockConfig } from '@/blocks/types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  arxiv: ArxivBlock,
  browser_use: BrowserUseBlock,
  clay: ClayBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  discord: DiscordBlock,
  elevenlabs: ElevenLabsBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  firecrawl: FirecrawlBlock,
  file: FileBlock,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  github: GitHubBlock,
  gmail: GmailBlock,
  guardrails: GuardrailsBlock,
  google_calendar: GoogleCalendarBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  google_vault: GoogleVaultBlock,
  historical_data: HistoricalDataBlock,
  huggingface: HuggingFaceBlock,
  hunter: HunterBlock,
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  jira: JiraBlock,
  knowledge: KnowledgeBlock,
  linear: LinearBlock,
  linkup: LinkupBlock,
  mcp: McpBlock,
  mem0: Mem0Block,
  zep: ZepBlock,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  mongodb: MongoDBBlock,
  mysql: MySQLBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  onedrive: OneDriveBlock,
  parallel_ai: ParallelBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  postgresql: PostgreSQLBlock,
  qdrant: QdrantBlock,
  resend: ResendBlock,
  memory: MemoryBlock,
  reddit: RedditBlock,
  response: ResponseBlock,
  router: RouterBlock,
  schedule: ScheduleBlock,
  s3: S3Block,
  serper: SerperBlock,
  sharepoint: SharepointBlock,
  // sms: SMSBlock,
  stagehand: StagehandBlock,
  stagehand_agent: StagehandAgentBlock,
  slack: SlackBlock,
  input_trigger: InputTriggerBlock,
  indicator_trigger: IndicatorTriggerBlock,
  chat_trigger: ChatTriggerBlock,
  manual_trigger: ManualTriggerBlock,
  api_trigger: ApiTriggerBlock,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  thinking: ThinkingBlock,
  trading_action: TradingActionBlock,
  trading_holdings: TradingHoldingsBlock,
  trading_order_detail: TradingOrderDetailBlock,
  trading_order_history: TradingOrderHistoryBlock,
  translate: TranslateBlock,
  twilio_sms: TwilioSMSBlock,
  typeform: TypeformBlock,
  variables: VariablesBlock,
  vision: VisionBlock,
  wait: WaitBlock,
  wealthbox: WealthboxBlock,
  webflow: WebflowBlock,
  webhook: WebhookBlock,
  whatsapp: WhatsAppBlock,
  wikipedia: WikipediaBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  x: XBlock,
  youtube: YouTubeBlock,

  ahrefs: AhrefsBlock,
  apify: ApifyBlock,
  apollo: ApolloBlock,
  asana: AsanaBlock,
  calendly: CalendlyBlock,
  circleback: CirclebackBlock,
  cursor: CursorBlock,
  datadog: DatadogBlock,
  dropbox: DropboxBlock,
  duckduckgo: DuckDuckGoBlock,
  dynamodb: DynamoDBBlock,
  elasticsearch: ElasticsearchBlock,
  fireflies: FirefliesBlock,
  gitlab: GitLabBlock,
  google_groups: GoogleGroupsBlock,
  google_slides: GoogleSlidesBlock,
  grafana: GrafanaBlock,
  grain: GrainBlock,
  greptile: GreptileBlock,
  hubspot: HubSpotBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  imap: ImapBlock,
  incidentio: IncidentioBlock,
  intercom: IntercomBlock,
  jira_service_management: JiraServiceManagementBlock,
  kalshi: KalshiBlock,
  linkedin: LinkedInBlock,
  mailchimp: MailchimpBlock,
  mailgun: MailgunBlock,
  neo4j: Neo4jBlock,
  note: NoteBlock,
  pipedrive: PipedriveBlock,
  polymarket: PolymarketBlock,
  posthog: PostHogBlock,
  rds: RDSBlock,
  rss: RssBlock,
  salesforce: SalesforceBlock,
  search: SearchBlock,
  sendgrid: SendGridBlock,
  sentry: SentryBlock,
  servicenow: ServiceNowBlock,
  shopify: ShopifyBlock,
  smtp: SmtpBlock,
  spotify: SpotifyBlock,
  sftp: SftpBlock,
  sqs: SQSBlock,
  ssh: SSHBlock,
  stripe: StripeBlock,
  stt: SttBlock,
  trello: TrelloBlock,
  tts: TtsBlock,
  twilio_voice: TwilioVoiceBlock,
  video_generator: VideoGeneratorBlock,
  webhook_request: WebhookRequestBlock,
  wordpress: WordPressBlock,
  zendesk: ZendeskBlock,
  zoom: ZoomBlock,
}

export const getBlock = (type: string): BlockConfig | undefined => registry[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string => type in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
