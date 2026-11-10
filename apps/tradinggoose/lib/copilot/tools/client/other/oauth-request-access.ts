import { CheckCircle, Loader2, MinusCircle, PlugZap, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'

const logger = createLogger('OAuthRequestAccessClientTool')

interface OAuthRequestAccessArgs {
  providerName?: string
}

function findServiceByName(providerName: string): string | null {
  const normalizedName = providerName.toLowerCase().trim()

  for (const [, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(providerConfig.services)) {
      if (service.name.toLowerCase() === normalizedName) {
        return serviceId
      }
    }
  }

  for (const [, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(providerConfig.services)) {
      if (
        service.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(service.name.toLowerCase())
      ) {
        return serviceId
      }
    }
  }

  return null
}

export class OAuthRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'oauth_request_access'

  private providerName?: string
  private opened = false
  private opening = false

  constructor(toolCallId: string) {
    super(toolCallId, OAuthRequestAccessClientTool.id, OAuthRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Requesting integration access', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Connecting integration', icon: Loader2 },
      [ClientToolCallState.rejected]: { text: 'Skipped integration access', icon: MinusCircle },
      [ClientToolCallState.success]: {
        text: 'Opened integration connection dialog',
        icon: CheckCircle,
      },
      [ClientToolCallState.error]: { text: 'Failed to request integration access', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted integration access request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Connect', icon: PlugZap },
      reject: { text: 'Skip', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      if (params.providerName) {
        const name = params.providerName
        switch (state) {
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Requesting ${name} access`
          case ClientToolCallState.executing:
            return `Connecting to ${name}`
          case ClientToolCallState.rejected:
            return `Skipped ${name} access`
          case ClientToolCallState.success:
            return `Opened ${name} connection dialog`
          case ClientToolCallState.error:
            return `Failed to connect ${name}`
          case ClientToolCallState.aborted:
            return `Aborted ${name} connection`
        }
      }
      return undefined
    },
  }

  async handleAccept(args?: OAuthRequestAccessArgs): Promise<void> {
    if (
      this.opened ||
      this.opening ||
      this.hasSubmittedResult() ||
      this.resolveResult<{ opened?: boolean }>()?.opened
    )
      return
    this.opening = true
    try {
      if (args?.providerName) {
        this.providerName = args.providerName
      }

      if (!this.providerName) {
        logger.error('No provider name provided')
        this.setState(ClientToolCallState.error)
        this.fail('No provider name specified')
        return
      }

      const serviceId = findServiceByName(this.providerName)
      if (!serviceId) {
        logger.error('Could not find OAuth service for provider', {
          providerName: this.providerName,
        })
        this.setState(ClientToolCallState.error)
        this.fail(`Unknown provider: ${this.providerName}`)
        return
      }

      logger.info('Opening OAuth connect flow', {
        providerName: this.providerName,
        serviceId,
      })

      this.setState(ClientToolCallState.executing)

      if (typeof window !== 'undefined') {
        await this.requireNativeTarget()
        const { workspaceId } = this.requireExecutionContext()
        this.getAbortSignal()?.throwIfAborted()
        if (!workspaceId) throw new Error('Missing original workspace context for OAuth callback')
        const url = new URL(
          `/workspace/${encodeURIComponent(workspaceId)}/integrations`,
          window.location.origin
        )
        url.searchParams.set('connect', serviceId)
        // noopener's Window.open feature returns null even after successful opening. Obtain
        // the blank, same-origin window, then disown it BEFORE any target navigation.
        const opened = window.open('about:blank', '_blank')
        if (!opened || opened.closed) throw new Error('Integration window was blocked')
        try {
          opened.opener = null
          if (opened.opener !== null) throw new Error('Integration window isolation failed')
          opened.location.replace(url.toString())
          if (opened.closed) throw new Error('Integration window was closed')
        } catch (error) {
          opened.close()
          throw error
        }
        this.opened = true
        const result = {
          opened: true,
          surface: 'integrations' as const,
          message: `Opened ${this.providerName} connection dialog`,
        }
        // Opening is a known UI fact even if the subsequent native acknowledgement fails.
        this.setState(ClientToolCallState.executing, { result })
        await this.completeBrowserAssertion({ kind: 'ui.opened', data: result })
        this.setState(ClientToolCallState.success, { result })
        return
      }

      throw new Error('Integration UI is unavailable')
    } catch (e) {
      logger.error('Failed to open OAuth connect flow', { error: e })
      this.setState(ClientToolCallState.error)
      this.fail(
        this.opened
          ? 'Integration window opened; native acknowledgement failed'
          : 'Failed to open OAuth connection dialog'
      )
    } finally {
      this.opening = false
    }
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async execute(args?: OAuthRequestAccessArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
