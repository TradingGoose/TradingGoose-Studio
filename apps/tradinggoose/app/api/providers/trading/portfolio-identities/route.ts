import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'
import { createLogger } from '@/lib/logs/console/logger'
import { getServiceByProviderAndId } from '@/lib/oauth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { listTradingPortfolioIdentities } from '@/lib/trading/portfolio-identities'
import { generateRequestId } from '@/lib/utils'
import {
  getPortfolioIdentityKey,
  type PortfolioIdentity,
} from '@/providers/trading/portfolio-identity'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('TradingPortfolioIdentitiesRoute')

const getAccountLabel = (portfolioIdentity: PortfolioIdentity) =>
  portfolioIdentity.accountName ?? portfolioIdentity.accountId

const getAccountDescription = (
  providerId: TradingProviderId,
  portfolioIdentity: PortfolioIdentity
) =>
  [
    getServiceByProviderAndId(providerId, portfolioIdentity.serviceId).name,
    portfolioIdentity.accountType,
    portfolioIdentity.accountStatus,
    portfolioIdentity.baseCurrency,
  ]
    .map((value) => (typeof value === 'string' && value.trim() !== 'unknown' ? value.trim() : ''))
    .filter(Boolean)
    .join(' - ')

export async function GET(request: Request) {
  const requestId = generateRequestId()
  const { searchParams } = new URL(request.url)
  const providerId = searchParams.get('provider')?.trim() as TradingProviderId | undefined
  const serviceId = searchParams.get('serviceId')?.trim() || undefined
  const workspaceId = searchParams.get('workspaceId')?.trim() || undefined
  const workflowId = searchParams.get('workflowId')?.trim() || undefined

  if (!providerId) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }

  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let effectiveWorkspaceId = workspaceId
  if (workflowId) {
    const access = await verifyWorkflowAccess(session.user.id, workflowId, 'read')
    if (!access.hasAccess || !access.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    effectiveWorkspaceId = access.workspaceId
  } else {
    if (!effectiveWorkspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }
    const access = await checkWorkspaceAccess(effectiveWorkspaceId, session.user.id)
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const provider = getTradingProviderDefinition(providerId)
  if (!provider?.oauth?.services?.length) {
    return NextResponse.json({ error: 'Unsupported trading provider' }, { status: 400 })
  }

  let portfolioIdentities: PortfolioIdentity[]
  try {
    portfolioIdentities = await listTradingPortfolioIdentities({
      userId: session.user.id,
      workspaceId: effectiveWorkspaceId,
      providerId,
      serviceId,
      requestId,
    })
  } catch (error) {
    logger.warn('Failed to list portfolio identities', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to load trading accounts' }, { status: 502 })
  }

  return NextResponse.json({
    options: portfolioIdentities.map((portfolioIdentity) => {
      const description = getAccountDescription(providerId, portfolioIdentity)
      return {
        id: getPortfolioIdentityKey(portfolioIdentity),
        label: getAccountLabel(portfolioIdentity),
        rightLabel: description,
        searchLabel: [
          getAccountLabel(portfolioIdentity),
          description,
          portfolioIdentity.providerName,
        ]
          .filter(Boolean)
          .join(' '),
        value: portfolioIdentity,
      }
    }),
  })
}
