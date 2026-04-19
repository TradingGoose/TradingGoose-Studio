import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from './core'

export const registrationModeEnum = pgEnum('registration_mode', [
  'open',
  'waitlist',
  'disabled',
])

export const waitlistStatusEnum = pgEnum('waitlist_status', [
  'pending',
  'approved',
  'rejected',
  'signed_up',
])

export const systemServiceValueKindEnum = pgEnum('system_service_value_kind', [
  'credential',
  'setting',
])

export type SystemBillingTierOwnerType = 'user' | 'organization'
export type SystemBillingTierStatus = 'active' | 'draft' | 'archived'
export type SystemBillingTierUsageScope = 'individual' | 'pooled'
export type SystemBillingTierSeatMode = 'fixed' | 'adjustable'

export interface SystemBillingTierSettings {
  id: string
  displayName: string
  description: string
  status: SystemBillingTierStatus
  ownerType: SystemBillingTierOwnerType
  usageScope: SystemBillingTierUsageScope
  seatMode: SystemBillingTierSeatMode
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
  includedUsageLimitUsd: number | null
  storageLimitGb: number | null
  concurrencyLimit: number | null
  seatCount: number | null
  seatMaximum: number | null
  stripeMonthlyPriceId: string | null
  stripeYearlyPriceId: string | null
  stripeProductId: string | null
  syncRateLimitPerMinute: number | null
  asyncRateLimitPerMinute: number | null
  apiEndpointRateLimitPerMinute: number | null
  maxPendingAgeSeconds: number | null
  maxPendingCount: number | null
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: number | null
  workflowModelCostMultiplier: number
  functionExecutionDurationMultiplier: number
  copilotCostMultiplier: number
  pricingFeatures: string[]
  isPublic: boolean
  isDefault: boolean
  displayOrder: number
}

export const systemAdmin = pgTable(
  'system_admin',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex('system_admin_user_id_unique').on(table.userId),
  }),
)

export const systemSettings = pgTable('system_settings', {
  // Global app-owned settings. Use this for platform behavior and identity fields,
  // not for third-party provider credentials or provider-specific runtime config.
  id: text('id').primaryKey(),
  registrationMode: registrationModeEnum('registration_mode')
    .notNull()
    .default('open'),
  billingEnabled: boolean('billing_enabled').notNull().default(false),
  triggerDevEnabled: boolean('trigger_dev_enabled').notNull().default(false),
  allowPromotionCodes: boolean('allow_promotion_codes').notNull().default(true),
  emailDomain: text('email_domain').notNull().default('tradinggoose.ai'),
  fromEmailAddress: text('from_email_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const systemServiceValue = pgTable(
  'system_service_values',
  {
    // Provider-owned runtime config. Credential rows are encrypted; setting rows are plain text.
    id: text('id').primaryKey(),
    service: text('service').notNull(),
    kind: systemServiceValueKindEnum('kind').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    serviceIdx: index('system_service_values_service_idx').on(table.service),
    serviceKindIdx: index('system_service_values_service_kind_idx').on(
      table.service,
      table.kind,
    ),
    serviceKeyUnique: uniqueIndex(
      'system_service_values_service_kind_key_unique',
    ).on(table.service, table.kind, table.key),
  }),
)

export const systemBillingSettings = pgTable(
  'system_billing_settings',
  {
    id: text('id').primaryKey(),
    onboardingAllowanceUsd: decimal('onboarding_allowance_usd')
      .notNull()
      .default('0'),
    overageThresholdDollars: decimal('overage_threshold_dollars')
      .notNull()
      .default('50'),
    workflowExecutionChargeUsd: decimal('workflow_execution_charge_usd')
      .notNull()
      .default('0'),
    functionExecutionChargeUsd: decimal('function_execution_charge_usd')
      .notNull()
      .default('0'),
    usageWarningThresholdPercent: integer('usage_warning_threshold_percent')
      .notNull()
      .default(80),
    freeTierUpgradeThresholdPercent: integer(
      'free_tier_upgrade_threshold_percent',
    )
      .notNull()
      .default(90),
    enterpriseContactUrl: text('enterprise_contact_url'),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    usageWarningThresholdCheck: check(
      'system_billing_settings_usage_warning_threshold_check',
      sql`${table.usageWarningThresholdPercent} between 1 and 100`,
    ),
    onboardingAllowanceCheck: check(
      'system_billing_settings_onboarding_allowance_check',
      sql`${table.onboardingAllowanceUsd} >= 0`,
    ),
    workflowExecutionChargeCheck: check(
      'system_billing_settings_workflow_execution_charge_check',
      sql`${table.workflowExecutionChargeUsd} >= 0`,
    ),
    functionExecutionChargeCheck: check(
      'system_billing_settings_function_execution_charge_check',
      sql`${table.functionExecutionChargeUsd} >= 0`,
    ),
    freeTierUpgradeThresholdCheck: check(
      'system_billing_settings_free_tier_upgrade_threshold_check',
      sql`${table.freeTierUpgradeThresholdPercent} between 1 and 100`,
    ),
    updatedByUserIdIdx: index(
      'system_billing_settings_updated_by_user_id_idx',
    ).on(table.updatedByUserId),
  }),
)

export const systemBillingTier = pgTable(
  'system_billing_tier',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull(),
    status: text('status')
      .$type<SystemBillingTierStatus>()
      .notNull()
      .default('draft'),
    ownerType: text('owner_type').$type<SystemBillingTierOwnerType>().notNull(),
    usageScope: text('usage_scope')
      .$type<SystemBillingTierUsageScope>()
      .notNull(),
    seatMode: text('seat_mode')
      .$type<SystemBillingTierSeatMode>()
      .notNull()
      .default('fixed'),
    monthlyPriceUsd: decimal('monthly_price_usd'),
    yearlyPriceUsd: decimal('yearly_price_usd'),
    includedUsageLimitUsd: decimal('included_usage_limit_usd'),
    storageLimitGb: integer('storage_limit_gb'),
    concurrencyLimit: integer('concurrency_limit'),
    seatCount: integer('seat_count'),
    seatMaximum: integer('seat_maximum'),
    stripeMonthlyPriceId: text('stripe_monthly_price_id'),
    stripeYearlyPriceId: text('stripe_yearly_price_id'),
    stripeProductId: text('stripe_product_id'),
    syncRateLimitPerMinute: integer('sync_rate_limit_per_minute'),
    asyncRateLimitPerMinute: integer('async_rate_limit_per_minute'),
    apiEndpointRateLimitPerMinute: integer(
      'api_endpoint_rate_limit_per_minute',
    ),
    maxPendingAgeSeconds: integer('max_pending_age_seconds'),
    maxPendingCount: integer('max_pending_count'),
    canEditUsageLimit: boolean('can_edit_usage_limit').notNull().default(false),
    canConfigureSso: boolean('can_configure_sso').notNull().default(false),
    logRetentionDays: integer('log_retention_days'),
    workflowModelCostMultiplier: decimal('workflow_model_cost_multiplier')
      .notNull()
      .default('1'),
    functionExecutionDurationMultiplier: decimal(
      'function_execution_duration_multiplier',
    )
      .notNull()
      .default('0'),
    copilotCostMultiplier: decimal('copilot_cost_multiplier')
      .notNull()
      .default('1'),
    pricingFeatures: jsonb('pricing_features')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isPublic: boolean('is_public').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('system_billing_tier_status_idx').on(table.status),
    displayOrderIdx: index('system_billing_tier_display_order_idx').on(
      table.displayOrder,
    ),
    updatedByUserIdIdx: index('system_billing_tier_updated_by_user_id_idx').on(
      table.updatedByUserId,
    ),
    statusCheck: check(
      'system_billing_tier_status_check',
      sql`${table.status} in ('active', 'draft', 'archived')`,
    ),
    ownerTypeCheck: check(
      'system_billing_tier_owner_type_check',
      sql`${table.ownerType} in ('user', 'organization')`,
    ),
    usageScopeCheck: check(
      'system_billing_tier_usage_scope_check',
      sql`${table.usageScope} in ('individual', 'pooled')`,
    ),
    seatModeCheck: check(
      'system_billing_tier_seat_mode_check',
      sql`${table.seatMode} in ('fixed', 'adjustable')`,
    ),
    seatCountCheck: check(
      'system_billing_tier_seat_count_check',
      sql`${table.seatCount} is null or ${table.seatCount} >= 1`,
    ),
    syncRateLimitCheck: check(
      'system_billing_tier_sync_rate_limit_check',
      sql`${table.syncRateLimitPerMinute} is null or ${table.syncRateLimitPerMinute} >= 0`,
    ),
    asyncRateLimitCheck: check(
      'system_billing_tier_async_rate_limit_check',
      sql`${table.asyncRateLimitPerMinute} is null or ${table.asyncRateLimitPerMinute} >= 0`,
    ),
    apiEndpointRateLimitCheck: check(
      'system_billing_tier_api_endpoint_rate_limit_check',
      sql`${table.apiEndpointRateLimitPerMinute} is null or ${table.apiEndpointRateLimitPerMinute} >= 0`,
    ),
    maxPendingAgeCheck: check(
      'system_billing_tier_max_pending_age_check',
      sql`${table.maxPendingAgeSeconds} is null or ${table.maxPendingAgeSeconds} >= 0`,
    ),
    maxPendingCountCheck: check(
      'system_billing_tier_max_pending_count_check',
      sql`${table.maxPendingCount} is null or ${table.maxPendingCount} >= 0`,
    ),
    logRetentionDaysCheck: check(
      'system_billing_tier_log_retention_days_check',
      sql`${table.logRetentionDays} is null or ${table.logRetentionDays} >= 0`,
    ),
    workflowModelCostMultiplierCheck: check(
      'system_billing_tier_workflow_model_cost_multiplier_check',
      sql`${table.workflowModelCostMultiplier} >= 0`,
    ),
    functionExecutionDurationMultiplierCheck: check(
      'system_billing_tier_function_execution_duration_multiplier_check',
      sql`${table.functionExecutionDurationMultiplier} >= 0`,
    ),
    copilotCostMultiplierCheck: check(
      'system_billing_tier_copilot_cost_multiplier_check',
      sql`${table.copilotCostMultiplier} >= 0`,
    ),
    seatRangeCheck: check(
      'system_billing_tier_seat_range_check',
      sql`${table.seatMaximum} is null or ${table.seatCount} is null or ${table.seatMaximum} >= ${table.seatCount}`,
    ),
    userOwnerShapeCheck: check(
      'system_billing_tier_user_owner_shape_check',
      sql`${table.ownerType} = 'organization' or (${table.usageScope} = 'individual' and ${table.seatMode} = 'fixed' and ${table.seatCount} is null and ${table.seatMaximum} is null)`,
    ),
    organizationSeatCountCheck: check(
      'system_billing_tier_org_seat_count_check',
      sql`${table.ownerType} = 'user' or ${table.seatCount} is not null`,
    ),
    fixedSeatMaximumCheck: check(
      'system_billing_tier_fixed_seat_maximum_check',
      sql`${table.seatMode} = 'adjustable' or ${table.seatMaximum} is null`,
    ),
    ssoOwnerTypeCheck: check(
      'system_billing_tier_sso_owner_type_check',
      sql`${table.ownerType} = 'organization' or ${table.canConfigureSso} = false`,
    ),
  }),
)

export const systemIntegrationDefinition = pgTable(
  'system_integration_definition',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references(
      (): AnyPgColumn => systemIntegrationDefinition.id,
      {
        onDelete: 'cascade',
      },
    ),
    name: text('name').notNull(),
    isEnabled: boolean('is_enabled'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    parentIdIdx: index('system_integration_definition_parent_id_idx').on(
      table.parentId,
    ),
    parentCheck: check(
      'system_integration_definition_parent_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    availabilityCheck: check(
      'system_integration_definition_availability_check',
      sql`(${table.parentId} is null and ${table.isEnabled} is null) or (${table.parentId} is not null and ${table.isEnabled} is not null)`,
    ),
  }),
)

export const systemIntegrationSecret = pgTable(
  'system_integration_secret',
  {
    id: text('id').primaryKey(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => systemIntegrationDefinition.id, {
        onDelete: 'cascade',
      }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    definitionIdIdx: index('system_integration_secret_definition_id_idx').on(
      table.definitionId,
    ),
    definitionKeyUnique: uniqueIndex(
      'system_integration_secret_definition_key_unique',
    ).on(table.definitionId, table.key),
  }),
)

export const waitlist = pgTable(
  'waitlist',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    status: waitlistStatusEnum('status').notNull().default('pending'),
    approvedAt: timestamp('approved_at'),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    rejectedAt: timestamp('rejected_at'),
    rejectedByUserId: text('rejected_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    signedUpAt: timestamp('signed_up_at'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('waitlist_email_idx').on(table.email),
    statusIdx: index('waitlist_status_idx').on(table.status),
    userIdIdx: index('waitlist_user_id_idx').on(table.userId),
  }),
)
