'use client'

import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getProviderIdFromServiceId,
  getServiceIdsFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { startOAuthConnectFlow } from '@/lib/oauth/connect'
import { getBaseUrl } from '@/lib/urls/utils'
import { usePathname } from '@/i18n/navigation'
import { formatTemplate } from '@/i18n/utils'
import { useWorkflowBlockEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('OAuthRequiredModal')

export interface OAuthRequiredModalProps {
  isOpen: boolean
  onClose: () => void
  onConnectStart?: () => void
  onConnectError?: () => void
  onConnectSettled?: () => void
  provider: OAuthProvider
  toolName: string
  callbackURL?: string
  requiredScopes?: string[]
  serviceId?: string
  serviceIds?: string[]
}

export function OAuthRequiredModal({
  isOpen,
  onClose,
  onConnectStart,
  onConnectError,
  onConnectSettled,
  provider,
  toolName,
  callbackURL,
  requiredScopes = [],
  serviceId,
  serviceIds,
}: OAuthRequiredModalProps) {
  const copy = useWorkflowBlockEditorCopy().oauthRequiredModal
  const pathname = usePathname()
  const { baseProvider } = parseProvider(provider)
  const showRobinhoodHelper = isHosted && baseProvider === 'robinhood'
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]
  const resolveExplicitServiceId = (candidate?: string) => {
    const normalized = candidate?.trim()
    if (!normalized) return undefined
    if (baseProviderConfig?.services[normalized]) return normalized
    const service = Object.values(baseProviderConfig?.services ?? {}).find(
      (item) => item.providerId === normalized
    )
    if (service) return service.id
    return normalized === baseProviderConfig?.id ? undefined : normalized
  }
  const explicitServiceId = resolveExplicitServiceId(serviceId)
  const explicitServiceIds = Array.from(
    new Set(
      (serviceIds ?? []).map(resolveExplicitServiceId).filter((id): id is string => Boolean(id))
    )
  )
  const inferredServiceIds = (() => {
    const providerServiceIds = Object.keys(baseProviderConfig?.services ?? {})
    if (requiredScopes.length === 0 && providerServiceIds.length > 1) {
      return providerServiceIds
    }
    return getServiceIdsFromScopes(provider, requiredScopes)
  })()
  const effectiveServiceIds = explicitServiceId
    ? [explicitServiceId]
    : explicitServiceIds.length
      ? explicitServiceIds
      : inferredServiceIds
  const effectiveServiceId = effectiveServiceIds[0] ?? provider
  const resolvedCallbackURL =
    callbackURL ??
    `${pathname}${typeof window === 'undefined' ? '' : window.location.search + window.location.hash}`
  const robinhoodHelperUrl = new URL('/connect/robinhood', getBaseUrl())
  robinhoodHelperUrl.searchParams.set('callbackURL', resolvedCallbackURL)

  // Default to base provider name and icon
  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon = baseProviderConfig?.icon || (() => null)

  // Try to find the specific service
  if (baseProviderConfig) {
    for (const service of Object.values(baseProviderConfig.services)) {
      if (
        (effectiveServiceIds.length === 1 && service.id === effectiveServiceId) ||
        (effectiveServiceIds.length === 1 && service.providerId === provider)
      ) {
        providerName = service.name
        ProviderIcon = service.icon
        break
      }
    }
  }

  const getServiceName = (connectServiceId: string) => {
    if (!baseProviderConfig) return connectServiceId
    return baseProviderConfig.services[connectServiceId]?.name ?? connectServiceId
  }

  const handleConnectDirectly = async (connectServiceId: string) => {
    try {
      // Determine the appropriate serviceId and providerId
      const providerId = getProviderIdFromServiceId(connectServiceId)

      onConnectStart?.()
      onClose()

      logger.info('Linking OAuth2:', {
        providerId,
        requiredScopes,
      })

      await startOAuthConnectFlow({
        providerId,
        callbackURL: resolvedCallbackURL,
      })
    } catch (error) {
      onConnectError?.()
      logger.error('Error initiating OAuth flow:', { error })
    } finally {
      onConnectSettled?.()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={showRobinhoodHelper ? 'min-w-0 sm:max-w-xl' : 'min-w-0 sm:max-w-md'}
      >
        <DialogHeader className='min-w-0'>
          <div className='flex min-w-0 items-start gap-3 text-left'>
            <div className='shrink-0 rounded-full bg-muted p-2'>
              <ProviderIcon className='h-5 w-5' />
            </div>
            <div className='min-w-0 space-y-1'>
              <DialogTitle>{formatTemplate(copy.connectProvider, { providerName })}</DialogTitle>
              <DialogDescription>
                {formatTemplate(copy.toolRequiresAccess, { toolName, providerName })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {showRobinhoodHelper ? (
          <div className='my-2 min-w-0 space-y-3 rounded-md border bg-muted/50 p-4'>
            <p className='text-muted-foreground text-sm'>{copy.robinhoodHostedHelper}</p>
            {[
              ['macOS / Linux', `curl -fsSL '${robinhoodHelperUrl}' | sh`],
              ['Windows PowerShell', `irm '${robinhoodHelperUrl}' | iex`],
            ].map(([platform, command]) => (
              <div key={platform} className='min-w-0 space-y-1'>
                <p className='font-medium text-xs'>{platform}</p>
                <CodeBlock
                  code={command}
                  className='min-w-0 max-w-full overflow-hidden bg-background'
                />
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter className='flex flex-col gap-2 sm:flex-row'>
          <Button variant='outline' onClick={onClose} className='sm:order-1'>
            {copy.cancel}
          </Button>
          {!showRobinhoodHelper &&
            (effectiveServiceIds.length > 1 ? (
              effectiveServiceIds.map((connectServiceId) => (
                <Button
                  key={connectServiceId}
                  type='button'
                  onClick={() => handleConnectDirectly(connectServiceId)}
                  className='sm:order-3'
                >
                  {formatTemplate(copy.connectService, {
                    serviceName: getServiceName(connectServiceId),
                  })}
                </Button>
              ))
            ) : (
              <Button
                type='button'
                onClick={() => handleConnectDirectly(effectiveServiceId)}
                className='sm:order-3'
              >
                {copy.connectNow}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
