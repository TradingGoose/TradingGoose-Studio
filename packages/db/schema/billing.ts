import {
  bigint,
  boolean,
  decimal,
  index,
  integer,
  json,
  primaryKey,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { organization, user } from './core'
import { systemBillingTier } from './system'

export const userStats = pgTable('user_stats', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(), // One record per user
  totalManualExecutions: integer('total_manual_executions').notNull().default(0),
  totalApiCalls: integer('total_api_calls').notNull().default(0),
  totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
  totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
  totalChatExecutions: integer('total_chat_executions').notNull().default(0),
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  totalCost: decimal('total_cost').notNull().default('0'),
  grantedOnboardingAllowanceUsd: decimal('granted_onboarding_allowance_usd').notNull().default('0'),
  customUsageLimit: decimal('custom_usage_limit'),
  customUsageLimitUpdatedAt: timestamp('custom_usage_limit_updated_at').defaultNow(),
  // Billing period tracking
  currentPeriodCost: decimal('current_period_cost').notNull().default('0'), // Usage in current billing period
  lastPeriodCost: decimal('last_period_cost').default('0'), // Usage from previous billing period
  billedOverageThisPeriod: decimal('billed_overage_this_period').notNull().default('0'), // Amount of overage already billed via threshold billing
  // Copilot usage tracking
  totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
  currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
  lastPeriodCopilotCost: decimal('last_period_copilot_cost').default('0'),
  totalCopilotTokens: integer('total_copilot_tokens').notNull().default(0),
  totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
  // Storage tracking for individual-scoped usage
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  lastActive: timestamp('last_active').notNull().defaultNow(),
  billingBlocked: boolean('billing_blocked').notNull().default(false),
})

export const organizationBillingLedger = pgTable(
  'organization_billing_ledger',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    totalManualExecutions: integer('total_manual_executions').notNull().default(0),
    totalApiCalls: integer('total_api_calls').notNull().default(0),
    totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
    totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
    totalChatExecutions: integer('total_chat_executions').notNull().default(0),
    totalTokensUsed: integer('total_tokens_used').notNull().default(0),
    totalCost: decimal('total_cost').notNull().default('0'),
    currentPeriodCost: decimal('current_period_cost').notNull().default('0'),
    lastPeriodCost: decimal('last_period_cost').notNull().default('0'),
    billedOverageThisPeriod: decimal('billed_overage_this_period').notNull().default('0'),
    totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
    currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
    lastPeriodCopilotCost: decimal('last_period_copilot_cost').notNull().default('0'),
    totalCopilotTokens: integer('total_copilot_tokens').notNull().default(0),
    totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
    billingBlocked: boolean('billing_blocked').notNull().default(false),
    lastActive: timestamp('last_active').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index('organization_billing_ledger_organization_id_idx').on(
      table.organizationId
    ),
  })
)

export const organizationMemberBillingLedger = pgTable(
  'organization_member_billing_ledger',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    totalManualExecutions: integer('total_manual_executions').notNull().default(0),
    totalApiCalls: integer('total_api_calls').notNull().default(0),
    totalWebhookTriggers: integer('total_webhook_triggers').notNull().default(0),
    totalScheduledExecutions: integer('total_scheduled_executions').notNull().default(0),
    totalChatExecutions: integer('total_chat_executions').notNull().default(0),
    totalTokensUsed: integer('total_tokens_used').notNull().default(0),
    totalCost: decimal('total_cost').notNull().default('0'),
    currentPeriodCost: decimal('current_period_cost').notNull().default('0'),
    lastPeriodCost: decimal('last_period_cost').notNull().default('0'),
    totalCopilotCost: decimal('total_copilot_cost').notNull().default('0'),
    currentPeriodCopilotCost: decimal('current_period_copilot_cost').notNull().default('0'),
    lastPeriodCopilotCost: decimal('last_period_copilot_cost').notNull().default('0'),
    totalCopilotTokens: integer('total_copilot_tokens').notNull().default(0),
    totalCopilotCalls: integer('total_copilot_calls').notNull().default(0),
    lastActive: timestamp('last_active').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationUserPk: primaryKey({
      name: 'organization_member_billing_ledger_pkey',
      columns: [table.organizationId, table.userId],
    }),
    organizationIdIdx: index('organization_member_billing_ledger_organization_id_idx').on(
      table.organizationId
    ),
    userIdIdx: index('organization_member_billing_ledger_user_id_idx').on(table.userId),
  })
)

export const subscription = pgTable(
  'subscription',
  {
    id: text('id').primaryKey(),
    // Better Auth Stripe still requires this field; it stores the immutable billing tier ID.
    plan: text('plan').notNull(),
    billingTierId: text('billing_tier_id').references(() => systemBillingTier.id, {
      onDelete: 'restrict',
    }),
    // Better Auth's Stripe plugin owns row creation and only writes referenceId directly.
    // Default to user, then normalize to the tier/customer owner immediately after sync.
    referenceType: text('reference_type')
      .$type<'user' | 'organization'>()
      .notNull()
      .default('user'),
    referenceId: text('reference_id').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text('status'),
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end'),
    seats: integer('seats'),
    trialStart: timestamp('trial_start'),
    trialEnd: timestamp('trial_end'),
    metadata: json('metadata'),
  },
  (table) => ({
    billingTierIdIdx: index('subscription_billing_tier_id_idx').on(table.billingTierId),
    referenceStatusIdx: index('subscription_reference_status_idx').on(
      table.referenceType,
      table.referenceId,
      table.status
    ),
  })
)

export const userRateLimits = pgTable('user_rate_limits', {
  referenceId: text('reference_id').primaryKey(), // Can be userId or organizationId for pooling
  syncApiRequests: integer('sync_api_requests').notNull().default(0), // Sync API requests counter
  asyncApiRequests: integer('async_api_requests').notNull().default(0), // Async API requests counter
  apiEndpointRequests: integer('api_endpoint_requests').notNull().default(0), // External API endpoint requests counter
  windowStart: timestamp('window_start').notNull().defaultNow(),
  lastRequestAt: timestamp('last_request_at').notNull().defaultNow(),
  isRateLimited: boolean('is_rate_limited').notNull().default(false),
  rateLimitResetAt: timestamp('rate_limit_reset_at'),
})

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'admin' or 'member' - team-level permissions only
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('member_user_id_idx').on(table.userId),
    organizationIdIdx: index('member_organization_id_idx').on(table.organizationId),
  })
)

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('invitation_email_idx').on(table.email),
    organizationIdIdx: index('invitation_organization_id_idx').on(table.organizationId),
  })
)

export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    domain: text('domain').notNull(),
    oidcConfig: text('oidc_config'),
    samlConfig: text('saml_config'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => ({
    providerIdIdx: index('sso_provider_provider_id_idx').on(table.providerId),
    domainIdx: index('sso_provider_domain_idx').on(table.domain),
    userIdIdx: index('sso_provider_user_id_idx').on(table.userId),
    organizationIdIdx: index('sso_provider_organization_id_idx').on(table.organizationId),
  })
)
