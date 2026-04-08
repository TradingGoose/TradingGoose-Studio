'use client'

import * as Icons from '@/components/icons/icons'
import * as ProviderIcons from '@/components/icons/provider-icons'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Marquee } from '@/components/ui/marquee'
import { MotionPreset } from '@/components/ui/motion-preset'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'

type BrandLogo = {
  icon: React.ComponentType<{ className?: string }>
  name: string
  style?: React.CSSProperties
}

const brandLogos: BrandLogo[] = [
  // AI models and providers
  { icon: ProviderIcons.OpenAIIcon, name: 'OpenAI' },
  { icon: Icons.PerplexityIcon, name: 'Perplexity' },
  { icon: ProviderIcons.MistralIcon, name: 'Mistral' },
  { icon: ProviderIcons.xAIIcon, name: 'xAI' },
  { icon: Icons.HuggingFaceIcon, name: 'HuggingFace' },
  { icon: Icons.ElevenLabsIcon, name: 'ElevenLabs' },
  { icon: Icons.CrewAIIcon, name: 'CrewAI' },
  { icon: Icons.VllmIcon, name: 'vLLM' },
  // Communication
  { icon: Icons.SlackIcon, name: 'Slack' },
  { icon: Icons.GmailIcon, name: 'Gmail' },
  { icon: Icons.DiscordIcon, name: 'Discord', style: { color: '#5765F2' } },
  { icon: Icons.TelegramIcon, name: 'Telegram' },
  { icon: Icons.WhatsAppIcon, name: 'WhatsApp' },
  { icon: Icons.MicrosoftTeamsIcon, name: 'Teams' },
  { icon: Icons.OutlookIcon, name: 'Outlook' },
  { icon: Icons.ZoomIcon, name: 'Zoom' },
  // Productivity
  { icon: Icons.NotionIcon, name: 'Notion' },
  { icon: Icons.GithubIcon, name: 'GitHub' },
  { icon: Icons.LinearIcon, name: 'Linear', style: { color: '#5E6AD2' } },
  { icon: Icons.JiraIcon, name: 'Jira' },
  { icon: Icons.ConfluenceIcon, name: 'Confluence' },
  { icon: Icons.TrelloIcon, name: 'Trello' },
  { icon: Icons.AsanaIcon, name: 'Asana' },
  { icon: Icons.GitLabIcon, name: 'GitLab' },
  // Google
  { icon: Icons.GoogleSheetsIcon, name: 'Google Sheets' },
  { icon: Icons.GoogleDriveIcon, name: 'Google Drive' },
  { icon: Icons.GoogleDocsIcon, name: 'Google Docs' },
  { icon: Icons.GoogleCalendarIcon, name: 'Google Calendar' },
  { icon: Icons.GoogleSlidesIcon, name: 'Google Slides' },
  { icon: Icons.GoogleFormsIcon, name: 'Google Forms' },
  // Data and storage
  { icon: Icons.PineconeIcon, name: 'Pinecone' },
  { icon: Icons.SupabaseIcon, name: 'Supabase' },
  { icon: Icons.PostgresIcon, name: 'PostgreSQL' },
  { icon: Icons.MySQLIcon, name: 'MySQL' },
  { icon: Icons.MongoDBIcon, name: 'MongoDB' },
  { icon: Icons.QdrantIcon, name: 'Qdrant' },
  { icon: Icons.ElasticsearchIcon, name: 'Elasticsearch' },
  { icon: Icons.Neo4jIcon, name: 'Neo4j' },
  // Cloud and infrastructure
  { icon: Icons.S3Icon, name: 'S3' },
  { icon: Icons.RDSIcon, name: 'RDS' },
  { icon: Icons.DynamoDBIcon, name: 'DynamoDB' },
  { icon: Icons.SQSIcon, name: 'SQS' },
  { icon: Icons.DropboxIcon, name: 'Dropbox' },
  { icon: Icons.MicrosoftOneDriveIcon, name: 'OneDrive' },
  { icon: Icons.MicrosoftSharepointIcon, name: 'SharePoint' },
  // Tools and services
  { icon: Icons.AirtableIcon, name: 'Airtable' },
  { icon: Icons.FirecrawlIcon, name: 'Firecrawl' },
  { icon: Icons.StripeIcon, name: 'Stripe' },
  { icon: Icons.ShopifyIcon, name: 'Shopify' },
  { icon: Icons.HubspotIcon, name: 'HubSpot' },
  { icon: Icons.SalesforceIcon, name: 'Salesforce' },
  { icon: Icons.TypeformIcon, name: 'Typeform' },
  { icon: Icons.CalendlyIcon, name: 'Calendly' },
  { icon: Icons.WebflowIcon, name: 'Webflow' },
  { icon: Icons.WordpressIcon, name: 'WordPress' },
  { icon: Icons.RedditIcon, name: 'Reddit' },
  { icon: Icons.YouTubeIcon, name: 'YouTube' },
  { icon: Icons.SpotifyIcon, name: 'Spotify' },
  { icon: Icons.BrowserUseIcon, name: 'BrowserUse' },
  { icon: Icons.StagehandIcon, name: 'Stagehand' },
  { icon: Icons.ApifyIcon, name: 'Apify' },
  // Monitoring and ops
  { icon: Icons.DatadogIcon, name: 'Datadog' },
  { icon: Icons.GrafanaIcon, name: 'Grafana' },
  { icon: Icons.SentryIcon, name: 'Sentry' },
  { icon: Icons.PosthogIcon, name: 'PostHog' },
  { icon: Icons.ServiceNowIcon, name: 'ServiceNow' },
  { icon: Icons.ZendeskIcon, name: 'Zendesk' },
  { icon: Icons.IntercomIcon, name: 'Intercom' },
  { icon: Icons.PipedriveIcon, name: 'Pipedrive' },
  { icon: Icons.SendgridIcon, name: 'SendGrid' },
  { icon: Icons.MailchimpIcon, name: 'Mailchimp' },
  // Research
  { icon: Icons.ArxivIcon, name: 'ArXiv' },
  { icon: Icons.WikipediaIcon, name: 'Wikipedia' },
  { icon: Icons.ExaAIIcon, name: 'Exa' },
  { icon: Icons.SerperIcon, name: 'Serper' },
  { icon: Icons.TavilyIcon, name: 'Tavily' },
  { icon: Icons.DuckDuckGoIcon, name: 'DuckDuckGo' },
]

// AI-readable entity list of integrations. This is the machine-readable
// companion to the visual logo marquee below — AI crawlers cannot parse
// React icon components, so we emit an ItemList JSON-LD snapshot.
const integrationsStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  '@id': 'https://tradinggoose.ai/#integrations',
  name: 'TradingGoose integrations',
  description:
    'Third-party services, LLM providers, data sources, and tools that TradingGoose integrates with as callable workflow blocks.',
  numberOfItems: brandLogos.length,
  itemListElement: brandLogos.map((logo, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'SoftwareApplication',
      name: logo.name,
    },
  })),
}

// Split logos evenly across 4 columns
const perCol = Math.ceil(brandLogos.length / 4)
const col1 = brandLogos.slice(0, perCol)
const col2 = brandLogos.slice(perCol, perCol * 2)
const col3 = brandLogos.slice(perCol * 2, perCol * 3)
const col4 = brandLogos.slice(perCol * 3)

function LogoAvatar({ icon: Icon, style }: BrandLogo) {
  return (
    <Avatar className='size-20'>
      <div className='flex h-full w-full items-center justify-center' style={style}>
        <Icon className='h-10 w-10' />
      </div>
    </Avatar>
  )
}

export default function Integrations() {
  useCardGlow()

  return (
    <section id='integrations' className='py-8 sm:py-16 lg:py-24'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(integrationsStructuredData) }}
      />
      <div className='mx-auto px-4 sm:px-6 lg:px-48'>
        <div className='flex items-start justify-between gap-12 max-md:flex-col sm:gap-16 lg:gap-24'>
          {/* Header */}
          <MotionPreset fade slide={{ direction: 'up', offset: 32 }} transition={{ duration: 0.5 }}>
            <div
              suppressHydrationWarning
              className='card group relative overflow-hidden rounded-lg bg-foreground/10 p-px transition-all duration-300 ease-in-out'
            >
              <div
                suppressHydrationWarning
                className='blob absolute top-0 left-0 h-[120px] w-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out'
                style={{ backgroundColor: 'hsl(var(--primary) / 0.7)' }}
              />
              <div
                className='fake-blob absolute top-0 left-0 h-40 w-40 rounded-full'
                style={{ visibility: 'hidden' }}
              />
              <Card className='relative overflow-hidden rounded-lg border shadow-none'>
                <div
                  className='pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
                  style={{
                    background:
                      'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), hsl(var(--primary) / 0.06), transparent 40%)',
                  }}
                />
                <CardContent className='relative z-10 space-y-4 p-6'>
                  <p className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'>
                    Integrations
                  </p>

                  <h2 className='font-semibold text-2xl md:text-3xl lg:text-4xl'>
                    LLM with more than just prompts.
                  </h2>

                  <div className='space-y-3 pt-10'>
                    {[
                      'Every integration becomes a tool your AI agents can call',
                      'Built-in blocks for messaging, databases, cloud storage, CRMs, and search',
                      'Custom MCP servers, skills, and tools you define yourself',
                    ].map((text) => (
                      <div key={text} className='flex items-center gap-3'>
                        <span className='h-px w-4 shrink-0 bg-primary' />
                        <p className='text-muted-foreground text-sm'>{text}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </MotionPreset>

          <div className='relative grid shrink-0 grid-cols-4 gap-4'>
            <div className='absolute top-0 z-[1] h-1/3 w-full bg-gradient-to-b from-background to-transparent' />
            <div className='absolute bottom-0 z-[1] h-1/3 w-full bg-gradient-to-t from-background to-transparent' />
            <Marquee vertical pauseOnHover duration={60} gap={1} className='h-[540px] w-fit p-0'>
              {col1.map((logo, index) => (
                <LogoAvatar key={index} {...logo} />
              ))}
            </Marquee>
            <Marquee
              vertical
              pauseOnHover
              duration={70}
              gap={1}
              reverse
              className='h-[540px] w-fit p-0'
            >
              {col2.map((logo, index) => (
                <LogoAvatar key={index} {...logo} />
              ))}
            </Marquee>
            <Marquee vertical pauseOnHover duration={65} gap={1} className='h-[540px] w-fit p-0'>
              {col3.map((logo, index) => (
                <LogoAvatar key={index} {...logo} />
              ))}
            </Marquee>
            <Marquee
              vertical
              pauseOnHover
              duration={75}
              gap={1}
              reverse
              className='h-[540px] w-fit p-0 '
            >
              {col4.map((logo, index) => (
                <LogoAvatar key={index} {...logo} />
              ))}
            </Marquee>
          </div>
        </div>
      </div>
    </section>
  )
}
