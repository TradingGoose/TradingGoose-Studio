import { db } from '@tradinggoose/db'
import { webhook, workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { getBaseUrl } from '@/lib/urls/utils'

const STRIPE_BILLING_EVENTS = [
  'charge.succeeded',
  'invoice.created',
  'invoice.finalized',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.deleted',
] as const

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const webhookId = new URL(request.url).searchParams.get('id')
  if (!webhookId) {
    return NextResponse.json({ success: false, error: 'Webhook ID is required' }, { status: 400 })
  }

  const [row] = await db
    .select({
      webhook,
      workflow: {
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(eq(webhook.id, webhookId))
    .limit(1)

  if (!row) {
    return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 })
  }

  let canRead = row.workflow.userId === session.user.id
  if (!canRead && row.workflow.workspaceId) {
    const permission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      row.workflow.workspaceId
    )
    canRead = permission === 'write' || permission === 'admin'
  }
  if (!canRead) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  if (row.webhook.provider !== 'stripe') {
    return NextResponse.json(
      { success: false, error: 'Stripe webhook is required' },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    webhook: {
      id: row.webhook.id,
      url: `${getBaseUrl()}/api/webhooks/trigger/${row.webhook.path}`,
      isActive: row.webhook.isActive,
    },
    setup: {
      url: `${getBaseUrl()}/api/webhooks/trigger/${row.webhook.path}`,
      events: STRIPE_BILLING_EVENTS,
    },
  })
}
