import type { ReactNode } from 'react'
import {
  AirtableIcon,
  ConfluenceIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleFormsIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  JiraIcon,
  LinearIcon,
  DollarIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftOneDriveIcon,
  MicrosoftPlannerIcon,
  MicrosoftSharepointIcon,
  MicrosoftTeamsIcon,
  NotionIcon,
  OutlookIcon,
  RedditIcon,
  SlackIcon,
  SupabaseIcon,
  WealthboxIcon,
  WebflowIcon,
  xIcon,
} from '@/components/icons/icons'
import { AlpacaIcon } from '@/components/icons/provider-icons'

export type OAuthProvider =
  | 'google'
  | 'github'
  | 'x'
  | 'supabase'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'discord'
  | 'microsoft'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'
  | 'webflow'
  | 'tradier'
  | string

export type OAuthService =
  | 'alpaca' // <-- here
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-vault'
  | 'google-forms'
  | 'github'
  | 'x'
  | 'supabase'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'discord'
  | 'microsoft-excel'
  | 'microsoft-teams'
  | 'microsoft-planner'
  | 'sharepoint'
  | 'outlook'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'
  | 'onedrive'
  | 'webflow'
  | 'tradier'
  | string

export interface OAuthCredentialFieldConfig {
  key: string
  label: string
  note: string
  placeholder: string
  isSensitive: boolean
  required?: boolean
  oauthProperty?: 'clientId' | 'clientSecret'
}

const DEFAULT_OAUTH_CREDENTIAL_FIELDS: OAuthCredentialFieldConfig[] = [
  {
    key: 'client_id',
    label: 'Client ID',
    note: 'Public app identifier',
    placeholder: 'Enter client ID',
    isSensitive: false,
    required: true,
    oauthProperty: 'clientId',
  },
  {
    key: 'client_secret',
    label: 'Client Secret',
    note: 'Private app credential',
    placeholder: 'Enter client secret',
    isSensitive: true,
    required: true,
    oauthProperty: 'clientSecret',
  },
]
export interface OAuthProviderConfig {
  id: OAuthProvider
  name: string
  icon: (props: { className?: string }) => ReactNode
  services: Record<string, OAuthServiceConfig>
  defaultService: string
  credentialProvider?: string
  credentialFields?: OAuthCredentialFieldConfig[]
}

export interface OAuthServiceConfig {
  id: string
  name: string
  description: string
  providerId: string
  icon: (props: { className?: string }) => ReactNode
  baseProviderIcon: (props: { className?: string }) => ReactNode
  scopes: string[]
  credentialProvider?: string
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    icon: (props) => AlpacaIcon(props),
    services: {
      alpaca: {
        id: 'alpaca',
        name: 'Alpaca',
        description: 'Trade and manage accounts with Alpaca.',
        providerId: 'alpaca',
        icon: (props) => AlpacaIcon(props),
        baseProviderIcon: (props) => AlpacaIcon(props),
        scopes: ['account:write', 'trading', 'data'],
      },
    },
    defaultService: 'alpaca',
  },
  google: {
    id: 'google',
    name: 'Google',
    icon: (props) => GoogleIcon(props),
    credentialProvider: 'google',
    services: {
      gmail: {
        id: 'gmail',
        name: 'Gmail',
        description: 'Automate email workflows and enhance communication efficiency.',
        providerId: 'google-email',
        icon: (props) => GmailIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          // 'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
      },
      'google-drive': {
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: (props) => GoogleDriveIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
      'google-docs': {
        id: 'google-docs',
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: (props) => GoogleDocsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
      'google-sheets': {
        id: 'google-sheets',
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: (props) => GoogleSheetsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
      'google-forms': {
        id: 'google-forms',
        name: 'Google Forms',
        description: 'Retrieve Google Form responses.',
        providerId: 'google-forms',
        icon: (props) => GoogleFormsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/forms.responses.readonly',
        ],
      },
      'google-calendar': {
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: (props) => GoogleCalendarIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/calendar'],
      },
      'google-vault': {
        id: 'google-vault',
        name: 'Google Vault',
        description: 'Search, export, and manage matters/holds via Google Vault.',
        providerId: 'google-vault',
        icon: (props) => GoogleIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/ediscovery',
          'https://www.googleapis.com/auth/devstorage.read_only',
        ],
      },
    },
    defaultService: 'gmail',
  },
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    icon: (props) => MicrosoftIcon(props),
    credentialProvider: 'microsoft',
    services: {
      'microsoft-excel': {
        id: 'microsoft-excel',
        name: 'Microsoft Excel',
        description: 'Connect to Microsoft Excel and manage spreadsheets.',
        providerId: 'microsoft-excel',
        icon: (props) => MicrosoftExcelIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      'microsoft-planner': {
        id: 'microsoft-planner',
        name: 'Microsoft Planner',
        description: 'Connect to Microsoft Planner and manage tasks.',
        providerId: 'microsoft-planner',
        icon: (props) => MicrosoftPlannerIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Group.ReadWrite.All',
          'Group.Read.All',
          'Tasks.ReadWrite',
          'offline_access',
        ],
      },
      'microsoft-teams': {
        id: 'microsoft-teams',
        name: 'Microsoft Teams',
        description: 'Connect to Microsoft Teams and manage messages.',
        providerId: 'microsoft-teams',
        icon: (props) => MicrosoftTeamsIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'User.Read',
          'Chat.Read',
          'Chat.ReadWrite',
          'Chat.ReadBasic',
          'Channel.ReadBasic.All',
          'ChannelMessage.Send',
          'ChannelMessage.Read.All',
          'Group.Read.All',
          'Group.ReadWrite.All',
          'Team.ReadBasic.All',
          'offline_access',
        ],
      },
      outlook: {
        id: 'outlook',
        name: 'Outlook',
        description: 'Connect to Outlook and manage emails.',
        providerId: 'outlook',
        icon: (props) => OutlookIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Mail.ReadWrite',
          'Mail.ReadBasic',
          'Mail.Read',
          'Mail.Send',
          'offline_access',
        ],
      },
      onedrive: {
        id: 'onedrive',
        name: 'OneDrive',
        description: 'Connect to OneDrive and manage files.',
        providerId: 'onedrive',
        icon: (props) => MicrosoftOneDriveIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      sharepoint: {
        id: 'sharepoint',
        name: 'SharePoint',
        description: 'Connect to SharePoint and manage sites.',
        providerId: 'sharepoint',
        icon: (props) => MicrosoftSharepointIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Sites.Read.All',
          'Sites.ReadWrite.All',
          'Sites.Manage.All',
          'offline_access',
        ],
      },
    },
    defaultService: 'outlook',
  },
  github: {
    id: 'github',
    name: 'GitHub',
    icon: (props) => GithubIcon(props),
    credentialProvider: 'github-repo',
    services: {
      github: {
        id: 'github',
        name: 'GitHub',
        description: 'Manage repositories, issues, and pull requests.',
        providerId: 'github-repo',
        icon: (props) => GithubIcon(props),
        baseProviderIcon: (props) => GithubIcon(props),
        scopes: ['repo', 'user:email', 'read:user', 'workflow'],
      },
    },
    defaultService: 'github',
  },
  x: {
    id: 'x',
    name: 'X',
    icon: (props) => xIcon(props),
    services: {
      x: {
        id: 'x',
        name: 'X',
        description: 'Read and post tweets on X (formerly Twitter).',
        providerId: 'x',
        icon: (props) => xIcon(props),
        baseProviderIcon: (props) => xIcon(props),
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      },
    },
    defaultService: 'x',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    icon: (props) => SupabaseIcon(props),
    services: {
      supabase: {
        id: 'supabase',
        name: 'Supabase',
        description: 'Connect to your Supabase projects and manage data.',
        providerId: 'supabase',
        icon: (props) => SupabaseIcon(props),
        baseProviderIcon: (props) => SupabaseIcon(props),
        scopes: ['database.read', 'database.write', 'projects.read'],
      },
    },
    defaultService: 'supabase',
  },
  confluence: {
    id: 'confluence',
    name: 'Confluence',
    icon: (props) => ConfluenceIcon(props),
    services: {
      confluence: {
        id: 'confluence',
        name: 'Confluence',
        description: 'Access Confluence content and documentation.',
        providerId: 'confluence',
        icon: (props) => ConfluenceIcon(props),
        baseProviderIcon: (props) => ConfluenceIcon(props),
        scopes: ['read:page:confluence', 'write:page:confluence', 'read:me', 'offline_access'],
      },
    },
    defaultService: 'confluence',
  },
  jira: {
    id: 'jira',
    name: 'Jira',
    icon: (props) => JiraIcon(props),
    services: {
      jira: {
        id: 'jira',
        name: 'Jira',
        description: 'Access Jira projects and issues.',
        providerId: 'jira',
        icon: (props) => JiraIcon(props),
        baseProviderIcon: (props) => JiraIcon(props),
        scopes: [
          'read:jira-user',
          'read:jira-work',
          'write:jira-work',
          'read:project:jira',
          'read:issue-type:jira',
          'read:me',
          'offline_access',
        ],
      },
    },
    defaultService: 'jira',
  },
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    icon: (props) => AirtableIcon(props),
    services: {
      airtable: {
        id: 'airtable',
        name: 'Airtable',
        description: 'Manage Airtable bases, tables, and records.',
        providerId: 'airtable',
        icon: (props) => AirtableIcon(props),
        baseProviderIcon: (props) => AirtableIcon(props),
        scopes: ['data.records:read', 'data.records:write'],
      },
    },
    defaultService: 'airtable',
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    icon: (props) => DiscordIcon(props),
    services: {
      discord: {
        id: 'discord',
        name: 'Discord',
        description: 'Read and send messages to Discord channels and interact with servers.',
        providerId: 'discord',
        icon: (props) => DiscordIcon(props),
        baseProviderIcon: (props) => DiscordIcon(props),
        scopes: ['identify', 'bot', 'messages.read', 'guilds', 'guilds.members.read'],
      },
    },
    defaultService: 'discord',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    icon: (props) => NotionIcon(props),
    services: {
      notion: {
        id: 'notion',
        name: 'Notion',
        description: 'Connect to your Notion workspace to manage pages and databases.',
        providerId: 'notion',
        icon: (props) => NotionIcon(props),
        baseProviderIcon: (props) => NotionIcon(props),
        scopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
      },
    },
    defaultService: 'notion',
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    icon: (props) => LinearIcon(props),
    services: {
      linear: {
        id: 'linear',
        name: 'Linear',
        description: 'Manage issues and projects in Linear.',
        providerId: 'linear',
        icon: (props) => LinearIcon(props),
        baseProviderIcon: (props) => LinearIcon(props),
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'linear',
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    icon: (props) => SlackIcon(props),
    services: {
      slack: {
        id: 'slack',
        name: 'Slack',
        description: 'Send messages using a Slack bot.',
        providerId: 'slack',
        icon: (props) => SlackIcon(props),
        baseProviderIcon: (props) => SlackIcon(props),
        scopes: [
          'channels:read',
          'chat:write',
          'chat:write.public',
          'users:read',
          'files:read',
          'links:read',
          'links:write',
        ],
      },
    },
    defaultService: 'slack',
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    icon: (props) => RedditIcon(props),
    services: {
      reddit: {
        id: 'reddit',
        name: 'Reddit',
        description: 'Access Reddit data and content from subreddits.',
        providerId: 'reddit',
        icon: (props) => RedditIcon(props),
        baseProviderIcon: (props) => RedditIcon(props),
        scopes: ['identity', 'read'],
      },
    },
    defaultService: 'reddit',
  },
  wealthbox: {
    id: 'wealthbox',
    name: 'Wealthbox',
    icon: (props) => WealthboxIcon(props),
    services: {
      wealthbox: {
        id: 'wealthbox',
        name: 'Wealthbox',
        description: 'Manage contacts, notes, and tasks in your Wealthbox CRM.',
        providerId: 'wealthbox',
        icon: (props) => WealthboxIcon(props),
        baseProviderIcon: (props) => WealthboxIcon(props),
        scopes: ['login', 'data'],
      },
    },
    defaultService: 'wealthbox',
  },
  tradier: {
    id: 'tradier',
    name: 'Tradier',
    icon: (props) => DollarIcon(props),
    services: {
      tradier: {
        id: 'tradier',
        name: 'Tradier',
        description: 'Trade equities and retrieve account data from Tradier.',
        providerId: 'tradier',
        icon: (props) => DollarIcon(props),
        baseProviderIcon: (props) => DollarIcon(props),
        scopes: ['read', 'write', 'trade'],
      },
    },
    defaultService: 'tradier',
  },
  webflow: {
    id: 'webflow',
    name: 'Webflow',
    icon: (props) => WebflowIcon(props),
    services: {
      webflow: {
        id: 'webflow',
        name: 'Webflow',
        description: 'Manage Webflow CMS collections, sites, and content.',
        providerId: 'webflow',
        icon: (props) => WebflowIcon(props),
        baseProviderIcon: (props) => WebflowIcon(props),
        scopes: ['cms:read', 'cms:write', 'sites:read', 'sites:write'],
      },
    },
    defaultService: 'webflow',
  },
}

export const MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS = 90
export const PROACTIVE_REFRESH_THRESHOLD_DAYS = 7
export const MICROSOFT_PROVIDERS = new Set(
  Object.values(OAUTH_PROVIDERS.microsoft?.services ?? {}).map((service) => service.providerId)
)

export function isMicrosoftProvider(providerId: string): boolean {
  return MICROSOFT_PROVIDERS.has(providerId)
}

export function getMicrosoftRefreshTokenExpiry(): Date {
  return new Date(Date.now() + MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}

type OAuthServiceLookupEntry = {
  baseProvider: string
  featureType: string
  serviceId: string
  providerId: string
  scopes: string[]
}

function normalizeOAuthIdentifier(value: string) {
  return value.trim()
}

function normalizeOAuthScope(value: string) {
  return value.trim().toLowerCase()
}

// Helper function to get a service by provider and service ID
export function getServiceByProviderAndId(
  provider: OAuthProvider,
  serviceId?: string
): OAuthServiceConfig {
  const normalizedProvider = normalizeOAuthIdentifier(provider)
  const providerConfig = resolveOAuthProviderConfig(normalizedProvider)
  if (!providerConfig) {
    throw new Error(`Provider ${normalizedProvider} not found`)
  }

  const resolvedServiceId =
    serviceId?.trim() ||
    getOAuthServiceLookupEntry(normalizedProvider)?.serviceId ||
    providerConfig.defaultService

  return providerConfig.services[resolvedServiceId] || providerConfig.services[providerConfig.defaultService]
}

// Helper function to determine service ID from scopes
export function getServiceIdFromScopes(provider: OAuthProvider, scopes: string[]): string {
  const normalizedProvider = normalizeOAuthIdentifier(provider)
  const directService = getOAuthServiceLookupEntry(normalizedProvider)
  if (directService) {
    return directService.serviceId
  }

  const providerConfig = OAUTH_PROVIDERS[normalizedProvider]
  if (!providerConfig) {
    return normalizedProvider
  }

  const normalizedScopes = Array.from(
    new Set(scopes.map(normalizeOAuthScope).filter(Boolean))
  )
  if (normalizedScopes.length === 0) {
    return providerConfig.defaultService
  }

  const matchingServices = Object.values(providerConfig.services).filter((service) => {
    const serviceScopes = new Set(service.scopes.map(normalizeOAuthScope))
    return normalizedScopes.every((scope) => serviceScopes.has(scope))
  })

  if (matchingServices.length === 1) {
    return matchingServices[0]!.id
  }

  const hintedServiceId = resolveServiceIdFromScopeHints(providerConfig.id, normalizedScopes)
  if (hintedServiceId) {
    return hintedServiceId
  }

  return providerConfig.defaultService
}

// Helper function to get provider ID from service ID
export function getProviderIdFromServiceId(serviceId: string): string {
  const normalizedServiceId = normalizeOAuthIdentifier(serviceId)
  const service = getOAuthServiceLookupEntry(normalizedServiceId)
  if (service) {
    return service.providerId
  }

  // Default fallback
  return normalizedServiceId
}

// Interface for credential objects
export interface Credential {
  id: string
  name: string
  provider: OAuthProvider
  serviceId?: string
  lastUsed?: string
  isDefault?: boolean
  scopes?: string[]
}

// Interface for provider configuration
export interface ProviderConfig {
  baseProvider: string
  featureType: string
}

export type OAuthProviderAvailability = Record<string, boolean>

const OAUTH_SERVICE_ENTRIES = Object.entries(OAUTH_PROVIDERS).flatMap(([baseProvider, providerConfig]) =>
  Object.entries(providerConfig.services).map(([featureType, service]) => ({
    baseProvider,
    featureType,
    serviceId: service.id,
    providerId: service.providerId,
    scopes: service.scopes,
  }))
) as OAuthServiceLookupEntry[]

const OAUTH_PROVIDER_LOOKUP = Object.fromEntries(
  OAUTH_SERVICE_ENTRIES.map((entry) => [
    entry.providerId,
    {
      baseProvider: entry.baseProvider,
      featureType: entry.featureType,
      serviceId: entry.serviceId,
      providerId: entry.providerId,
      scopes: entry.scopes,
    },
  ])
) as Record<string, OAuthServiceLookupEntry>

const OAUTH_SERVICE_LOOKUP = Object.fromEntries(
  OAUTH_SERVICE_ENTRIES.map((entry) => [
    entry.serviceId,
    {
      baseProvider: entry.baseProvider,
      featureType: entry.featureType,
      serviceId: entry.serviceId,
      providerId: entry.providerId,
      scopes: entry.scopes,
    },
  ])
) as Record<string, OAuthServiceLookupEntry>

const OAUTH_SCOPE_HINTS: Record<string, Array<{ serviceId: string; patterns: string[] }>> = {
  google: [
    { serviceId: 'gmail', patterns: ['gmail', 'mail'] },
    { serviceId: 'google-docs', patterns: ['docs'] },
    { serviceId: 'google-sheets', patterns: ['sheets'] },
    { serviceId: 'google-drive', patterns: ['drive'] },
    { serviceId: 'google-calendar', patterns: ['calendar'] },
    { serviceId: 'google-forms', patterns: ['forms'] },
    { serviceId: 'google-vault', patterns: ['ediscovery'] },
  ],
  microsoft: [
    { serviceId: 'microsoft-teams', patterns: ['chat.', 'channel', 'team.'] },
    { serviceId: 'outlook', patterns: ['mail.'] },
    { serviceId: 'sharepoint', patterns: ['sites.'] },
    { serviceId: 'microsoft-planner', patterns: ['tasks.', 'group.readwrite', 'group.read.all'] },
    { serviceId: 'onedrive', patterns: ['files.'] },
  ],
}

function getOAuthServiceLookupEntry(identifier: string): OAuthServiceLookupEntry | null {
  const normalizedIdentifier = normalizeOAuthIdentifier(identifier)
  return OAUTH_SERVICE_LOOKUP[normalizedIdentifier] ?? OAUTH_PROVIDER_LOOKUP[normalizedIdentifier] ?? null
}

function resolveOAuthProviderConfig(identifier: string) {
  const normalizedIdentifier = normalizeOAuthIdentifier(identifier)
  if (OAUTH_PROVIDERS[normalizedIdentifier]) {
    return OAUTH_PROVIDERS[normalizedIdentifier]
  }

  const service = getOAuthServiceLookupEntry(normalizedIdentifier)
  return service ? OAUTH_PROVIDERS[service.baseProvider] : null
}

function cloneOAuthCredentialFields(fields: OAuthCredentialFieldConfig[]) {
  return fields.map((field) => ({ ...field }))
}

export function getOAuthCredentialFields(identifier: string) {
  const providerConfig = resolveOAuthProviderConfig(identifier)
  return cloneOAuthCredentialFields(
    providerConfig?.credentialFields ?? DEFAULT_OAUTH_CREDENTIAL_FIELDS
  )
}

function resolveServiceIdFromScopeHints(baseProvider: string, normalizedScopes: string[]) {
  const providerHints = OAUTH_SCOPE_HINTS[baseProvider]
  if (!providerHints) {
    return null
  }

  const matchedHint = providerHints.find((hint) =>
    normalizedScopes.some((scope) => hint.patterns.some((pattern) => scope.includes(pattern)))
  )

  return matchedHint?.serviceId ?? null
}

export const SYSTEM_INTEGRATION_OAUTH_SERVICE_PROVIDER_IDS = new Set(
  Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
    Object.values(provider.services).map((service) => service.providerId)
  )
)

export const SIGN_IN_OAUTH_PROVIDER_IDS = new Set(['google', 'github'])

export function isSystemIntegrationManagedOAuthServiceProviderId(providerId: string) {
  return SYSTEM_INTEGRATION_OAUTH_SERVICE_PROVIDER_IDS.has(providerId.trim())
}

export function isSignInOAuthProviderId(providerId: string) {
  return SIGN_IN_OAUTH_PROVIDER_IDS.has(providerId.trim())
}

export function getCanonicalScopesForProvider(providerId: string): string[] {
  const normalizedProviderId = normalizeOAuthIdentifier(providerId)
  const serviceLookup =
    OAUTH_PROVIDER_LOOKUP[normalizedProviderId] ?? OAUTH_SERVICE_LOOKUP[normalizedProviderId]

  return serviceLookup?.scopes
    ? [...serviceLookup.scopes]
    : []
}

export function getBaseProviderForService(providerId: string): string {
  const normalizedProviderId = normalizeOAuthIdentifier(providerId)
  const serviceLookup =
    OAUTH_PROVIDER_LOOKUP[normalizedProviderId] ?? OAUTH_SERVICE_LOOKUP[normalizedProviderId]

  return serviceLookup?.baseProvider || parseProvider(normalizedProviderId).baseProvider
}

/**
 * Parse a provider string into its base provider and feature type
 * This is a server-safe utility that can be used in both client and server code
 */
export function parseProvider(provider: OAuthProvider): ProviderConfig {
  const normalizedProvider = normalizeOAuthIdentifier(provider)
  const mapping = OAUTH_PROVIDER_LOOKUP[normalizedProvider] ?? OAUTH_SERVICE_LOOKUP[normalizedProvider]
  if (mapping) {
    return {
      baseProvider: mapping.baseProvider,
      featureType: mapping.featureType,
    }
  }

  // Handle compound providers (e.g., 'google-email' -> { baseProvider: 'google', featureType: 'email' })
  const [base, feature = 'default'] = normalizedProvider.split('-')
  return {
    baseProvider: base,
    featureType: feature,
  }
}

export function getOAuthProviderSubjectId(input: {
  provider?: string | null
  serviceId?: string | null
  requiredScopes?: string[]
}): string | null {
  const provider = input.provider?.trim()
  const serviceId = input.serviceId?.trim()
  const requiredScopes = input.requiredScopes ?? []

  if (serviceId) {
    return getProviderIdFromServiceId(serviceId)
  }

  if (!provider) {
    return null
  }

  if (requiredScopes.length > 0) {
    const derivedServiceId = getServiceIdFromScopes(provider as OAuthProvider, requiredScopes)
    return getProviderIdFromServiceId(derivedServiceId)
  }

  const providerConfig = resolveOAuthProviderConfig(provider)
  if (providerConfig) {
    return getProviderIdFromServiceId(providerConfig.defaultService)
  }

  return getProviderIdFromServiceId(provider)
}
