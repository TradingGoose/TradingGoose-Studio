import { AsyncLocalStorage } from 'node:async_hooks'
import { getCurrentAuthEndpointContext } from '@better-auth/core/context'
import { sso } from '@better-auth/sso'
import { stripe } from '@better-auth/stripe'
import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from 'better-auth/api'
import { revokeUnprovenAccountAccess } from 'better-auth/db'
import { nextCookies } from 'better-auth/next-js'
import { emailOTP, genericOAuth, oneTimeToken, organization, username } from 'better-auth/plugins'
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'

/** OAuth2 token type extracted from better-auth's GenericOAuthConfig */
type OAuthTokens = Parameters<NonNullable<GenericOAuthConfig['getUserInfo']>>[0]

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderOTPEmail,
  renderPasswordResetEmail,
} from '@/components/emails/render-email'
import { sendBillingTierWelcomeEmail } from '@/lib/billing'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { ensureDefaultUserSubscription } from '@/lib/billing/core/subscription'
import { handleNewUser } from '@/lib/billing/core/usage'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { getBetterAuthPlansConfig } from '@/lib/billing/plans'
import { getBillingGateState } from '@/lib/billing/settings'
import { createStripeUserCustomer } from '@/lib/billing/stripe-customers'
import { BILLING_ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { hydrateSubscriptionsWithTiers } from '@/lib/billing/tiers'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import {
  handleInvoiceFinalized,
  handleInvoicePaymentFailed,
  handleInvoiceResolved,
} from '@/lib/billing/webhooks/invoices'
import {
  handleStripeSubscriptionDeleted,
  handleStripeSubscriptionUpdated,
  handleSubscriptionCreated,
} from '@/lib/billing/webhooks/subscription'
import { resolveEmailLocale } from '@/lib/email/locale'
import { hasEmailService, sendEmail, syncUserEmailAudience } from '@/lib/email/mailer'
import { env, getEnv } from '@/lib/env'
import { isEmailVerificationEnabled, isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getCanonicalScopesForProvider,
  getMicrosoftRefreshTokenExpiry,
  HUBSPOT_OAUTH_SCOPES,
  isMicrosoftProvider,
  isSystemIntegrationManagedOAuthServiceProviderId,
  MICROSOFT_PROVIDERS,
  OAUTH_PROVIDERS,
} from '@/lib/oauth'
import { addRobinhoodOAuthClientToState, registerRobinhoodOAuthClient } from '@/lib/oauth/robinhood'
import {
  getRobinhoodOAuthRedirectUri,
  ROBINHOOD_OAUTH_RESOURCE,
} from '@/lib/oauth/robinhood-constants'
import {
  getSystemOAuthClientCredentialsForRequest,
  setSystemOAuthClientIdForRequest,
} from '@/lib/oauth/system-managed-config'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getRegistrationDenialReason, markWaitlistEntrySignedUp } from '@/lib/registration/service'
import { findVerifiedSsoProviderId, getSsoOrganizationAccess } from '@/lib/sso/access'
import { ssoProviderIdSchema } from '@/lib/sso/consts'
import {
  createStripeClientProxy,
  getStripeServiceConfig,
  hasStripeSecretKey,
} from '@/lib/system-services/stripe-runtime'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'
import { getBaseUrl } from '@/lib/urls/utils'
import { createDefaultWorkspaceForUser } from '@/lib/workspaces/service'
import { resolveAlpacaTradingBaseUrl } from '@/providers/trading/alpaca/config'
import { resolveTradierBaseUrl } from '@/providers/trading/tradier/client'

const logger = createLogger('Auth')

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const authTransaction = new AsyncLocalStorage<AuthTransaction>()
const authDb: typeof db = Object.create(db, {
  transaction: {
    // Better Auth's before hooks must share the connection held by its transaction.
    value: <T>(run: (tx: AuthTransaction) => Promise<T>) =>
      db.transaction((tx) => authTransaction.run(tx, run, tx)),
  },
})

function isLoginEmailAllowed(email: string): boolean {
  if (!env.ALLOWED_LOGIN_EMAILS && !env.ALLOWED_LOGIN_DOMAINS) return true
  const normalizedEmail = email.trim().toLowerCase()
  const domain = normalizedEmail.split('@')[1]
  return Boolean(
    env.ALLOWED_LOGIN_EMAILS?.split(',').some(
      (allowed: string) => allowed.trim().toLowerCase() === normalizedEmail
    ) ||
      env.ALLOWED_LOGIN_DOMAINS?.split(',').some(
        (allowed: string) => allowed.trim().toLowerCase() === domain
      )
  )
}

const BASE_TRUSTED_OAUTH_PROVIDERS = [
  'google',
  'github',
  'email-password',
  'confluence',
  'supabase',
  'x',
  'notion',
  'microsoft',
  'slack',
  'reddit',
  'webflow',
  'hubspot',
]

const TRUSTED_OAUTH_PROVIDER_IDS = Array.from(
  new Set([
    ...BASE_TRUSTED_OAUTH_PROVIDERS,
    // These integration profiles supply account IDs without an email, for authenticated linking only.
    'robinhood',
    'alpaca-live',
    'alpaca-paper',
    'tradier-live',
    'wealthbox',
    ...Object.entries(OAUTH_PROVIDERS).flatMap(([baseProvider, providerConfig]) =>
      BASE_TRUSTED_OAUTH_PROVIDERS.includes(baseProvider)
        ? Object.values(providerConfig.services).map((service) => service.providerId)
        : []
    ),
  ])
)

async function handleCompletedSubscription(input: {
  subscriptionId: string
  stripeSubscription: Stripe.Subscription
}) {
  await syncSubscriptionBillingTierFromStripeSubscription(input)
  const rows = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.id, input.subscriptionId))
    .limit(1)
  const [subscription] = await hydrateSubscriptionsWithTiers(rows)
  if (!subscription) throw new Error(`Subscription ${input.subscriptionId} could not be hydrated`)
  await handleSubscriptionCreated(subscription)
  await syncSubscriptionUsageLimits(subscription)
  await sendBillingTierWelcomeEmail(subscription)
}

type SystemManagedGenericOAuthConfig = Omit<GenericOAuthConfig, 'clientId' | 'clientSecret'>
type EnvBackedSocialProviderConfig = {
  clientId: string
  clientSecret: string
}

function toSystemManagedGenericOAuthConfigs(
  configs: SystemManagedGenericOAuthConfig[]
): GenericOAuthConfig[] {
  return configs.map((config) => ({
    ...config,
    // Link workflow connections by provider subject without supplying a Studio sign-in email.
    mapProfileToUser: () => ({ email: undefined }),
    get clientId() {
      return getSystemOAuthClientCredentialsForRequest(config.providerId).clientId
    },
    get clientSecret() {
      return getSystemOAuthClientCredentialsForRequest(config.providerId).clientSecret
    },
    get authentication() {
      // Studio loads confidential client credentials for the current request.
      return this.clientSecret ? config.authentication : undefined
    },
  }))
}

function createRobinhoodOAuthConfig(): SystemManagedGenericOAuthConfig {
  const providerId = 'robinhood'
  const redirectUri = getRobinhoodOAuthRedirectUri(getBaseUrl(), isHosted)
  return {
    providerId,
    authorizationUrl: 'https://robinhood.com/oauth',
    tokenUrl: 'https://api.robinhood.com/oauth2/token/',
    authorizationUrlParams: { resource: ROBINHOOD_OAUTH_RESOURCE },
    tokenUrlParams: { resource: ROBINHOOD_OAUTH_RESOURCE },
    authentication: 'post',
    pkce: true,
    scopes: getCanonicalScopesForProvider(providerId),
    redirectURI: redirectUri,
    disableSignUp: true,
    getUserInfo: async (tokens) => {
      if (!tokens.accessToken?.trim()) throw new Error('Robinhood access token is required')
      const userUuid = typeof tokens.raw?.user_uuid === 'string' ? tokens.raw.user_uuid.trim() : ''
      if (!userUuid) throw new Error('Robinhood token response is missing the user identity')
      return {
        id: userUuid,
        name: 'Robinhood',
        emailVerified: false,
      }
    },
  }
}

function createAlpacaOAuthConfig(environment: 'live' | 'paper'): SystemManagedGenericOAuthConfig {
  const providerId = `alpaca-${environment}`
  return {
    providerId,
    authorizationUrl: 'https://app.alpaca.markets/oauth/authorize',
    authorizationUrlParams: { env: environment },
    tokenUrl: 'https://api.alpaca.markets/oauth/token',
    authentication: 'post',
    scopes: getCanonicalScopesForProvider(providerId),
    getUserInfo: async (tokens) => {
      const response = await fetch(`${resolveAlpacaTradingBaseUrl(environment)}/v2/account`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })
      if (!response.ok) return null
      const data = await response.json()
      return {
        id: data.id,
        name: data.account_number,
        emailVerified: false,
      }
    },
  }
}

function createTradierOAuthConfig(): SystemManagedGenericOAuthConfig {
  const providerId = 'tradier-live'
  return {
    providerId,
    authorizationUrl: 'https://api.tradier.com/v1/oauth/authorize',
    tokenUrl: 'https://api.tradier.com/v1/oauth/accesstoken',
    authentication: 'basic',
    scopes: getCanonicalScopesForProvider(providerId),
    getUserInfo: async (tokens) => {
      const response = await fetch(`${resolveTradierBaseUrl()}/user/profile`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      })
      if (!response.ok) return null
      const data = await response.json()
      const account = Array.isArray(data?.profile?.account)
        ? data.profile.account[0]
        : data?.profile?.account
      const accountNumber =
        typeof account?.account_number === 'string' ? account.account_number.trim() : ''
      if (!accountNumber) return null
      const classification =
        typeof account.classification === 'string' ? account.classification.trim() : ''

      return {
        id: `${providerId}:${accountNumber}`,
        name: classification ? `${classification} (${accountNumber})` : accountNumber,
        emailVerified: false,
      }
    },
  }
}

function toEnvBackedSocialProviderConfig<T extends EnvBackedSocialProviderConfig>(
  envKeys: {
    clientId: string
    clientSecret: string
  },
  config: Omit<T, 'clientId' | 'clientSecret'>
): T
function toEnvBackedSocialProviderConfig<T extends Record<string, unknown>>(
  envKeys: {
    clientId: string
    clientSecret: string
  },
  config: T
): T & EnvBackedSocialProviderConfig
function toEnvBackedSocialProviderConfig(
  envKeys: {
    clientId: string
    clientSecret: string
  },
  config: Record<string, unknown>
) {
  const providerConfig = {
    ...config,
    clientId: '',
    clientSecret: '',
  }

  Object.defineProperties(providerConfig, {
    clientId: {
      enumerable: true,
      configurable: true,
      get() {
        return getEnv(envKeys.clientId)?.trim() ?? ''
      },
    },
    clientSecret: {
      enumerable: true,
      configurable: true,
      get() {
        return getEnv(envKeys.clientSecret)?.trim() ?? ''
      },
    },
  })

  return providerConfig
}

function hasEnvBackedSocialProviderCredentials(envKeys: {
  clientId: string
  clientSecret: string
}) {
  return Boolean(getEnv(envKeys.clientId)?.trim() && getEnv(envKeys.clientSecret)?.trim())
}

function buildSocialProviders() {
  const socialProviders: Record<string, Record<string, unknown>> = {}

  if (
    hasEnvBackedSocialProviderCredentials({
      clientId: 'GITHUB_CLIENT_ID',
      clientSecret: 'GITHUB_CLIENT_SECRET',
    })
  ) {
    socialProviders.github = toEnvBackedSocialProviderConfig(
      {
        clientId: 'GITHUB_CLIENT_ID',
        clientSecret: 'GITHUB_CLIENT_SECRET',
      },
      {
        scopes: ['user:email', 'repo'],
      }
    )
  }

  if (
    hasEnvBackedSocialProviderCredentials({
      clientId: 'GOOGLE_CLIENT_ID',
      clientSecret: 'GOOGLE_CLIENT_SECRET',
    })
  ) {
    socialProviders.google = toEnvBackedSocialProviderConfig(
      {
        clientId: 'GOOGLE_CLIENT_ID',
        clientSecret: 'GOOGLE_CLIENT_SECRET',
      },
      {
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
      }
    )
  }

  return socialProviders
}

const MICROSOFT_OAUTH_BASE_CONFIG = {
  authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
  responseType: 'code' as const,
  accessType: 'offline' as const,
  authentication: 'basic' as const,
  pkce: true,
}

function createMicrosoftOAuthProvider(providerId: string) {
  return {
    ...MICROSOFT_OAUTH_BASE_CONFIG,
    providerId,
    scopes: getCanonicalScopesForProvider(providerId),
    getUserInfo: async (tokens: OAuthTokens) => getMicrosoftUserInfoFromIdToken(tokens, providerId),
  }
}

function getMicrosoftUserInfoFromIdToken(tokens: OAuthTokens, providerId: string) {
  const idToken = tokens.idToken
  if (!idToken) {
    logger.error(`Microsoft ${providerId} OAuth: no ID token received`)
    throw new Error(`Microsoft ${providerId} OAuth requires an ID token`)
  }

  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error(`Microsoft ${providerId} OAuth: malformed ID token`)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
  } catch {
    throw new Error(`Microsoft ${providerId} OAuth: failed to decode ID token payload`)
  }

  const email =
    (payload.email as string) || (payload.preferred_username as string) || (payload.upn as string)
  if (!email) {
    throw new Error(
      `Microsoft ${providerId} OAuth: ID token contains no email, preferred_username, or upn claim`
    )
  }

  const tenantId = typeof payload.tid === 'string' ? payload.tid.trim() : ''
  const objectId = typeof payload.oid === 'string' ? payload.oid.trim() : ''
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : ''
  const identity = tenantId && objectId ? `${tenantId}:${objectId}` : subject
  if (!identity) {
    throw new Error(`Microsoft ${providerId} OAuth: ID token contains no stable identity claim`)
  }

  const now = new Date()
  return {
    id: identity,
    name: (payload.name as string) || 'Microsoft User',
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  }
}

const stripeClient = createStripeClientProxy()

async function createStripeCustomerForSignedUpUser(user: {
  id: string
  email: string
  name: string
}) {
  const stripeCustomer = await createStripeUserCustomer(stripeClient, {
    email: user.email,
    name: user.name,
    userId: user.id,
  })

  await db
    .update(schema.user)
    .set({
      stripeCustomerId: stripeCustomer.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.id, user.id))

  logger.info('[databaseHooks.user.create.after] Created Stripe customer for user', {
    userId: user.id,
    stripeCustomerId: stripeCustomer.id,
  })
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  trustedOrigins: [
    getBaseUrl(),
    ...(env.NEXT_PUBLIC_SOCKET_URL ? [env.NEXT_PUBLIC_SOCKET_URL] : []),
  ],
  advanced: {
    crossSubDomainCookies: { enabled: false },
  },
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema,
    transaction: true,
  }),
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days (how long a session can last overall)
    updateAge: 24 * 60 * 60, // 24 hours (how often to refresh the expiry)
    freshAge: 60 * 60, // 1 hour (or set to 0 to disable completely)
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const message = await getRegistrationDenialReason(user.email, authTransaction.getStore())
          if (message) throw new APIError('BAD_REQUEST', { message })
        },
        after: async (user) => {
          logger.info('[databaseHooks.user.create.after] User created, initializing stats', {
            userId: user.id,
          })

          await createDefaultWorkspaceForUser(user.id, user.name)

          try {
            await markWaitlistEntrySignedUp(user.email, user.id)
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to mark waitlist signup', {
              userId: user.id,
              email: user.email,
              error,
            })
          }

          try {
            await handleNewUser(user.id)

            const { billingEnabled } = await getBillingGateState()
            if (billingEnabled) {
              await ensureDefaultUserSubscription(user.id)
            }
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to initialize user stats', {
              userId: user.id,
              error,
            })
          }

          if (hasStripeSecretKey()) {
            try {
              await createStripeCustomerForSignedUpUser(user)
            } catch (error) {
              logger.error('[databaseHooks.user.create.after] Failed to create Stripe customer', {
                userId: user.id,
                error,
              })
            }
          }

          if (user.emailVerified) {
            await syncUserEmailAudience(user)
          }
        },
      },
      update: {
        after: async (user, ctx) => {
          if (ctx?.path === '/email-otp/reset-password' && user.emailVerified) {
            await syncUserEmailAudience(user)
          }
        },
      },
    },
    account: {
      delete: {
        before: async (account, ctx) => {
          if (
            (ctx?.path === '/sign-in/email-otp' ||
              ctx?.path === '/email-otp/verify-email' ||
              ctx?.path === '/verify-email') &&
            isSystemIntegrationManagedOAuthServiceProviderId(account.providerId)
          ) {
            return false
          }
        },
      },
      create: {
        before: async (account) => {
          if (account.providerId !== 'robinhood') return
          const oauthClientId = getSystemOAuthClientCredentialsForRequest('robinhood').clientId
          if (!oauthClientId) throw new Error('Robinhood OAuth client registration is missing')
          return { data: { ...account, oauthClientId } }
        },
        after: async (account) => {
          if (!isMicrosoftProvider(account.providerId)) {
            return
          }

          try {
            await db
              .update(schema.account)
              .set({ refreshTokenExpiresAt: getMicrosoftRefreshTokenExpiry() })
              .where(eq(schema.account.id, account.id))
          } catch (error) {
            logger.error(
              '[databaseHooks.account.create.after] Failed to set Microsoft refresh token expiry',
              {
                accountId: account.id,
                providerId: account.providerId,
                error,
              }
            )
          }
        },
      },
      update: {
        before: async (account) => {
          if (typeof account.refreshToken !== 'string' || !account.refreshToken.trim()) return
          const oauthClientId = getSystemOAuthClientCredentialsForRequest('robinhood').clientId
          return oauthClientId ? { data: { ...account, oauthClientId } } : undefined
        },
      },
    },
    verification: {
      create: {
        before: async (verification, context) => {
          if (context?.path !== '/link-social' || context.body?.provider !== 'robinhood') return
          const clientId = await registerRobinhoodOAuthClient(
            getRobinhoodOAuthRedirectUri(getBaseUrl(), isHosted)
          )
          setSystemOAuthClientIdForRequest('robinhood', clientId)
          return {
            data: {
              ...verification,
              value: addRobinhoodOAuthClientToState(verification.value, clientId),
            },
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          if (context?.path === '/sign-in/username') {
            const user = await context.context.internalAdapter.findUserById(session.userId)
            if (!user || !isLoginEmailAllowed(user.email)) {
              throw new APIError('FORBIDDEN', {
                message: 'Access restricted. Please contact your administrator.',
              })
            }
          }
          try {
            // Find the first organization this user is a member of
            const members = await (authTransaction.getStore() ?? db)
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            if (members.length > 0) {
              logger.info('Found organization for user', {
                userId: session.userId,
                organizationId: members[0].organizationId,
              })

              return {
                data: {
                  ...session,
                  activeOrganizationId: members[0].organizationId,
                },
              }
            }
            logger.info('No organizations found for user', {
              userId: session.userId,
            })
            return { data: session }
          } catch (error) {
            logger.error('Error setting active organization', {
              error,
              userId: session.userId,
            })
            return { data: session }
          }
        },
      },
    },
  },
  account: {
    additionalFields: {
      oauthClientId: {
        type: 'string',
        required: false,
        input: false,
        returned: false,
      },
    },
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: TRUSTED_OAUTH_PROVIDER_IDS,
    },
  },
  socialProviders: buildSocialProviders(),
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    requireEmailVerification: isEmailVerificationEnabled,
    sendResetPassword: async ({ user, url }) => {
      const username = user.name || ''
      const locale = await resolveEmailLocale({ userId: user.id, email: user.email })

      const html = await renderPasswordResetEmail(username, url, locale)

      const result = await sendEmail({
        to: user.email,
        subject: getEmailSubject('reset-password', locale),
        html,
        emailType: 'transactional',
      })

      if (!result.success) {
        throw new Error(`Failed to send reset password email: ${result.message}`)
      }
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    async sendVerificationEmail({ user }, request) {
      const { context } = getCurrentAuthEndpointContext()
      // Better Auth's verification sender selects unverified mailboxes before issuing this code.
      const requestReset = context.getPlugin('email-otp')?.endpoints?.requestPasswordResetEmailOTP
      if (!requestReset) throw new Error('The email OTP plugin is required')
      await requestReset({
        context,
        request,
        body: { email: user.email },
      })
    },
    autoSignInAfterVerification: true,
    beforeEmailVerification: async (user) => {
      const ctx = getCurrentAuthEndpointContext()
      if (
        !user.emailVerified &&
        (ctx.path === '/email-otp/verify-email' || ctx.path === '/verify-email')
      ) {
        // These verification callbacks run inside the dispatched Better Auth endpoint.
        const promoted = await revokeUnprovenAccountAccess(
          ctx as Parameters<typeof revokeUnprovenAccountAccess>[0],
          user.id
        )
        if (!promoted?.emailVerified) throw new APIError('CONFLICT')
      }
    },
    afterEmailVerification: async (user) => {
      const ctx = getCurrentAuthEndpointContext()
      await syncUserEmailAudience(
        user,
        ctx.path === '/email-otp/change-email' ? ctx.context.session?.user.email : undefined
      )
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/change-password') {
        return { context: { body: { ...ctx.body, revokeOtherSessions: true } } }
      }
      if (
        (ctx.path === '/send-verification-email' ||
          ctx.path === '/email-otp/send-verification-otp' ||
          ctx.path === '/email-otp/request-password-reset' ||
          ctx.path === '/email-otp/request-email-change') &&
        !(await hasEmailService())
      ) {
        throw new APIError('SERVICE_UNAVAILABLE', {
          code: 'EMAIL_DELIVERY_UNAVAILABLE',
          message: 'No email service configured',
        })
      }
      if (
        ['/sso/request-domain-verification', '/sso/verify-domain', '/sso/update-provider'].includes(
          ctx.path
        ) &&
        typeof ctx.body?.providerId === 'string'
      ) {
        const session = await getAuthoritativeSessionFromCtx(ctx)
        if (!session?.user.id) throw new APIError('UNAUTHORIZED', { message: 'Unauthorized' })

        const provider = await ctx.context.adapter.findOne<{ organizationId?: string | null }>({
          model: 'ssoProvider',
          where: [{ field: 'providerId', value: ctx.body.providerId }],
          select: ['organizationId'],
        })
        if (provider) {
          const access = provider.organizationId
            ? await getSsoOrganizationAccess(session.user.id, provider.organizationId)
            : null
          if (!access?.canConfigureSso) {
            throw new APIError('FORBIDDEN', {
              message:
                access && !access.canManageOrganization
                  ? "You don't have access to this provider"
                  : 'Single Sign-On is not enabled for this organization',
            })
          }
        }
      }
      if (ctx.path === '/sso/register') {
        const providerId = ssoProviderIdSchema.safeParse(ctx.body?.providerId)
        if (!providerId.success) {
          throw new APIError('BAD_REQUEST', {
            code: 'INVALID_PROVIDER_ID',
            message: providerId.error.issues[0].message,
          })
        }
        ctx.body.providerId = providerId.data
      }
      if (
        ctx.path === '/sign-up/email' &&
        (typeof ctx.body?.username !== 'string' || !ctx.body.username.trim())
      ) {
        throw new APIError('BAD_REQUEST', {
          code: 'USERNAME_REQUIRED',
          message: 'Username is required',
        })
      }
      if (
        (ctx.path === '/email-otp/request-email-change' ||
          ctx.path === '/email-otp/change-email') &&
        typeof ctx.body?.newEmail === 'string' &&
        !isLoginEmailAllowed(ctx.body.newEmail)
      ) {
        throw new APIError('FORBIDDEN', {
          code: 'EMAIL_CHANGE_NOT_ALLOWED',
          message: 'This email address is not allowed to sign in',
        })
      }

      if (
        (ctx.path.startsWith('/sign-in') ||
          ctx.path.startsWith('/sign-up') ||
          ctx.path === '/email-otp/verify-email' ||
          ctx.path === '/email-otp/reset-password') &&
        typeof ctx.body?.email === 'string' &&
        !isLoginEmailAllowed(ctx.body.email)
      ) {
        throw new Error('Access restricted. Please contact your administrator.')
      }

      if (ctx.path === '/sign-in/sso' && !ctx.body?.providerId && !ctx.body?.organizationSlug) {
        const email = ctx.body?.email
        const search = ctx.body?.domain || (typeof email === 'string' && email.split('@')[1])
        if (typeof search === 'string' && search) {
          const providerId = await findVerifiedSsoProviderId(ctx.context.adapter, search)
          if (providerId) return { context: { body: { ...ctx.body, providerId } } }
        }
      }
    }),
  },
  plugins: [
    username(),
    oneTimeToken({
      expiresIn: 24 * 60 * 60, // 24 hours - Socket.IO handles connection persistence with heartbeats
    }),
    emailOTP({
      disableSignUp: true,
      // https://better-auth.com/docs/plugins/email-otp#confirming-with-current-email
      changeEmail: { enabled: true, verifyCurrentEmail: true },
      sendVerificationOTP: async ({ email, otp, type }, ctx) => {
        try {
          const locale = await resolveEmailLocale({ email, userId: ctx?.context.session?.user.id })
          const subject = getEmailSubject(type, locale)
          const result = await sendEmail({
            to: email,
            subject,
            html: await renderOTPEmail(otp, email, type, undefined, locale),
            text: `${subject}\n\n${otp}`,
            emailType: 'transactional',
          })
          if (!result.success) throw new Error(result.message)
        } catch (error) {
          if (
            ctx &&
            (type === 'change-email' ||
              (type === 'email-verification' &&
                (await getAuthoritativeSessionFromCtx(ctx))?.user.email.toLowerCase() ===
                  email.toLowerCase()))
          ) {
            ctx.setStatus(503)
          }
          throw error
        }
      },
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
    }),
    genericOAuth({
      config: toSystemManagedGenericOAuthConfigs([
        createRobinhoodOAuthConfig(),
        createAlpacaOAuthConfig('live'),
        createAlpacaOAuthConfig('paper'),
        createTradierOAuthConfig(),
        {
          providerId: 'github-repo',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          accessType: 'offline',
          prompt: 'consent',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'repo', 'read:user', 'workflow'],
          getUserInfo: async (tokens) => {
            try {
              const profileResponse = await fetch('https://api.github.com/user', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                  'User-Agent': 'tradinggoose-studio',
                },
              })

              if (!profileResponse.ok) {
                logger.error('Failed to fetch GitHub profile', {
                  status: profileResponse.status,
                  statusText: profileResponse.statusText,
                })
                throw new Error(`Failed to fetch GitHub profile: ${profileResponse.statusText}`)
              }

              const profile = await profileResponse.json()

              if (!profile.email) {
                const emailsResponse = await fetch('https://api.github.com/user/emails', {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                    'User-Agent': 'tradinggoose-studio',
                  },
                })

                if (emailsResponse.ok) {
                  const emails = await emailsResponse.json()

                  const primaryEmail =
                    emails.find(
                      (email: { primary: boolean; email: string; verified: boolean }) =>
                        email.primary
                    ) || emails[0]
                  if (primaryEmail) {
                    profile.email = primaryEmail.email
                    profile.emailVerified = primaryEmail.verified || false
                  }
                } else {
                  logger.warn('Failed to fetch GitHub emails', {
                    status: emailsResponse.status,
                    statusText: emailsResponse.statusText,
                  })
                }
              }

              const now = new Date()

              return {
                id: profile.id.toString(),
                name: profile.name || profile.login,
                email: profile.email,
                image: profile.avatar_url,
                emailVerified: profile.emailVerified || false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in GitHub getUserInfo', { error })
              throw error
            }
          },
        },

        ...Object.values(OAUTH_PROVIDERS.google.services).map(
          ({ providerId, scopes }): SystemManagedGenericOAuthConfig => ({
            providerId,
            authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            accessType: 'offline',
            prompt: 'consent',
            pkce: true,
            scopes: [
              ...new Set([
                'openid',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile',
                ...scopes,
              ]),
            ],
            getUserInfo: async ({ accessToken }) => {
              if (!accessToken) return null
              const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              })
              if (!response.ok) return null
              const profile = await response.json()
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
                emailVerified: profile.email_verified,
              }
            },
          })
        ),

        ...[...MICROSOFT_PROVIDERS].map(createMicrosoftOAuthProvider),

        {
          providerId: 'wealthbox',
          authorizationUrl: 'https://app.crmworkspace.com/oauth/authorize',
          tokenUrl: 'https://app.crmworkspace.com/oauth/token',
          userInfoUrl: 'https://api.crmworkspace.com/v1/me',
          accountSubject: ({ profile }) => {
            const workspaceId = (profile.current_user as { account?: number } | undefined)?.account
            return typeof profile.id === 'number' && typeof workspaceId === 'number'
              ? `${profile.id}:${workspaceId}`
              : ''
          },
          scopes: ['login', 'data'],
        },

        // Supabase provider
        {
          providerId: 'supabase',
          authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
          tokenUrl: 'https://api.supabase.com/v1/oauth/token',
          userInfoUrl: 'https://dummy-not-used.supabase.co',
          scopes: ['database.read', 'database.write', 'projects.read'],
          responseType: 'code',
          pkce: true,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Supabase user profile from token data')

              let userId = 'supabase-user'
              if (tokens.idToken) {
                try {
                  const decodedToken = JSON.parse(
                    Buffer.from(tokens.idToken.split('.')[1], 'base64').toString()
                  )
                  if (decodedToken.sub) {
                    userId = decodedToken.sub
                  }
                } catch (e) {
                  logger.warn('Failed to decode Supabase ID token', {
                    error: e,
                  })
                }
              }

              const uniqueId = `${userId}-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Supabase User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@supabase.user`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error creating Supabase user profile:', { error })
              return null
            }
          },
        },

        // X provider
        {
          providerId: 'x',
          authorizationUrl: 'https://x.com/i/oauth2/authorize',
          tokenUrl: 'https://api.x.com/2/oauth2/token',
          userInfoUrl: 'https://api.x.com/2/users/me',
          accessType: 'offline',
          scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
          pkce: true,
          responseType: 'code',
          prompt: 'consent',
          authentication: 'basic',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch(
                'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name,verified',
                {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                  },
                }
              )

              if (!response.ok) {
                logger.error('Error fetching X user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()

              if (!profile.data) {
                logger.error('Invalid X profile response:', profile)
                return null
              }

              const now = new Date()

              return {
                id: profile.data.id,
                name: profile.data.name || 'X User',
                email: `${profile.data.username}@x.com`,
                image: profile.data.profile_image_url,
                emailVerified: profile.data.verified || false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in X getUserInfo:', { error })
              return null
            }
          },
        },

        // Confluence provider
        {
          providerId: 'confluence',
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          userInfoUrl: 'https://api.atlassian.com/me',
          scopes: ['read:page:confluence', 'write:page:confluence', 'read:me', 'offline_access'],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.atlassian.com/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Confluence user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()

              const now = new Date()

              return {
                id: profile.account_id,
                name: profile.name || profile.display_name || 'Confluence User',
                email: profile.email || `${profile.account_id}@atlassian.com`,
                image: profile.picture || undefined,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Confluence getUserInfo:', { error })
              return null
            }
          },
        },

        // Discord provider
        {
          providerId: 'discord',
          authorizationUrl: 'https://discord.com/api/oauth2/authorize',
          tokenUrl: 'https://discord.com/api/oauth2/token',
          userInfoUrl: 'https://discord.com/api/users/@me',
          scopes: getCanonicalScopesForProvider('discord'),
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://discord.com/api/users/@me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Discord user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()
              const now = new Date()

              return {
                id: profile.id,
                name: profile.username || 'Discord User',
                email: profile.email,
                image: profile.avatar
                  ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                  : undefined,
                emailVerified: profile.verified,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Discord getUserInfo:', { error })
              return null
            }
          },
        },

        // Jira provider
        {
          providerId: 'jira',
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          userInfoUrl: 'https://api.atlassian.com/me',
          scopes: [
            'read:jira-user',
            'read:jira-work',
            'write:jira-work',
            'write:issue:jira',
            'read:project:jira',
            'read:issue-type:jira',
            'read:me',
            'offline_access',
            'read:issue-meta:jira',
            'read:issue-security-level:jira',
            'read:issue.vote:jira',
            'read:issue.changelog:jira',
            'read:avatar:jira',
            'read:issue:jira',
            'read:status:jira',
            'read:user:jira',
            'read:field-configuration:jira',
            'read:issue-details:jira',
          ],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.atlassian.com/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Jira user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()

              const now = new Date()

              return {
                id: profile.account_id,
                name: profile.name || profile.display_name || 'Jira User',
                email: profile.email || `${profile.account_id}@atlassian.com`,
                image: profile.picture || undefined,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Jira getUserInfo:', { error })
              return null
            }
          },
        },

        // Airtable provider
        {
          providerId: 'airtable',
          authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
          tokenUrl: 'https://airtable.com/oauth2/v1/token',
          userInfoUrl: 'https://api.airtable.com/v0/meta/whoami',
          scopes: ['data.records:read', 'data.records:write', 'user.email:read', 'webhook:manage'],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.airtable.com/v0/meta/whoami', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Airtable user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const data = await response.json()
              const now = new Date()

              return {
                id: data.id,
                name: data.email ? data.email.split('@')[0] : 'Airtable User',
                email: data.email || `${data.id}@airtable.user`,
                emailVerified: !!data.email,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Airtable getUserInfo:', { error })
              return null
            }
          },
        },

        // Notion provider
        {
          providerId: 'notion',
          authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
          tokenUrl: 'https://api.notion.com/v1/oauth/token',
          userInfoUrl: 'https://api.notion.com/v1/users/me',
          scopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
          responseType: 'code',
          pkce: false,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.notion.com/v1/users/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                  'Notion-Version': '2022-06-28',
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Notion user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()
              const now = new Date()

              return {
                id: profile.bot?.owner?.user?.id || profile.id,
                name: profile.name || profile.bot?.owner?.user?.name || 'Notion User',
                email: profile.person?.email || `${profile.id}@notion.user`,
                emailVerified: !!profile.person?.email,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Notion getUserInfo:', { error })
              return null
            }
          },
        },

        // Reddit provider
        {
          providerId: 'reddit',
          authorizationUrl: 'https://www.reddit.com/api/v1/authorize?duration=permanent',
          tokenUrl: 'https://www.reddit.com/api/v1/access_token',
          userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
          scopes: ['identity', 'read'],
          responseType: 'code',
          pkce: false,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://oauth.reddit.com/api/v1/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                  'User-Agent': 'tradinggoose-studio/1.0',
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Reddit user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const data = await response.json()
              const now = new Date()

              return {
                id: data.id,
                name: data.name || 'Reddit User',
                email: `${data.name}@reddit.user`,
                image: data.icon_img || undefined,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Reddit getUserInfo:', { error })
              return null
            }
          },
        },

        {
          providerId: 'linear',
          authorizationUrl: 'https://linear.app/oauth/authorize',
          tokenUrl: 'https://api.linear.app/oauth/token',
          scopes: ['read', 'write'],
          responseType: 'code',
          pkce: true,
          prompt: 'consent',
          accessType: 'offline',
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.linear.app/graphql', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
                body: JSON.stringify({
                  query: `{
                    viewer {
                      id
                      email
                      name
                      avatarUrl
                    }
                  }`,
                }),
              })

              if (!response.ok) {
                const errorText = await response.text()
                logger.error('Linear API error:', {
                  status: response.status,
                  statusText: response.statusText,
                  body: errorText,
                })
                throw new Error(`Linear API error: ${response.status} ${response.statusText}`)
              }

              const { data, errors } = await response.json()

              if (errors) {
                logger.error('GraphQL errors:', errors)
                throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`)
              }

              if (!data?.viewer) {
                logger.error('No viewer data in response:', data)
                throw new Error('No viewer data in response')
              }

              const viewer = data.viewer

              return {
                id: viewer.id,
                email: viewer.email,
                name: viewer.name,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                image: viewer.avatarUrl || undefined,
              }
            } catch (error) {
              logger.error('Error in getUserInfo:', error)
              throw error
            }
          },
        },

        // Slack provider
        {
          providerId: 'slack',
          authorizationUrl: 'https://slack.com/oauth/v2/authorize',
          tokenUrl: 'https://slack.com/api/oauth.v2.access',
          userInfoUrl: 'https://slack.com/api/users.identity',
          pkce: false,
          scopes: [
            // Bot token scopes only - app acts as a bot user
            'channels:read',
            'channels:history',
            'groups:read',
            'groups:history',
            'chat:write',
            'chat:write.public',
            'users:read',
            'files:write',
            'canvases:write',
          ],
          responseType: 'code',
          accessType: 'offline',
          prompt: 'consent',
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Slack bot profile from token data')

              // Extract user identifier from tokens if possible
              let userId = 'slack-bot'
              if (tokens.idToken) {
                try {
                  const decodedToken = JSON.parse(
                    Buffer.from(tokens.idToken.split('.')[1], 'base64').toString()
                  )
                  if (decodedToken.sub) {
                    userId = decodedToken.sub
                  }
                } catch (e) {
                  logger.warn('Failed to decode Slack ID token', { error: e })
                }
              }

              const uniqueId = `${userId}-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Slack Bot',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@slack.bot`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error creating Slack bot profile:', { error })
              return null
            }
          },
        },

        // Webflow provider
        {
          providerId: 'webflow',
          authorizationUrl: 'https://webflow.com/oauth/authorize',
          tokenUrl: 'https://api.webflow.com/oauth/access_token',
          userInfoUrl: 'https://api.webflow.com/v2/token/introspect',
          scopes: ['sites:read', 'sites:write', 'cms:read', 'cms:write'],
          responseType: 'code',
          getUserInfo: async (tokens) => {
            try {
              logger.info('Fetching Webflow user info')

              const response = await fetch('https://api.webflow.com/v2/token/introspect', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Webflow user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const data = await response.json()
              const now = new Date()

              const userIds = Array.isArray(data.authorization?.authorizedTo?.userIds)
                ? [
                    ...new Set(
                      data.authorization.authorizedTo.userIds
                        .filter((id: unknown): id is string => typeof id === 'string')
                        .map((id: string) => id.trim())
                        .filter(Boolean)
                    ),
                  ].sort()
                : []
              if (!userIds.length) {
                logger.error('Webflow token introspection returned no stable user identity')
                return null
              }
              const uniqueId = `webflow-${userIds.join(':')}`

              return {
                id: uniqueId,
                name: data.user_name || 'Webflow User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@webflow.user`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Webflow getUserInfo:', { error })
              return null
            }
          },
        },

        {
          providerId: 'hubspot',
          authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
          tokenUrl: 'https://api.hubspot.com/oauth/v3/token',
          scopes: HUBSPOT_OAUTH_SCOPES,
          responseType: 'code',
          getUserInfo: async (tokens) => {
            try {
              const credentials = getSystemOAuthClientCredentialsForRequest('hubspot')
              const response = await fetch('https://api.hubspot.com/oauth/v3/token/introspect', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  client_id: credentials.clientId,
                  client_secret: credentials.clientSecret,
                  token_type_hint: 'access_token',
                  access_token: tokens.accessToken ?? '',
                }).toString(),
              })

              if (!response.ok) {
                logger.error('Error fetching HubSpot token metadata:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()
              const hubId = String(profile.hub_id ?? 'hubspot')
              const userId = String(profile.user_id ?? profile.user ?? crypto.randomUUID())
              const email = profile.user || `${userId}@hubspot.user`
              const now = new Date()

              return {
                id: `${hubId}-${userId}`,
                name: profile.user || profile.hub_domain || 'HubSpot User',
                email,
                emailVerified: Boolean(profile.user),
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in HubSpot getUserInfo:', { error })
              return null
            }
          },
        },
      ] as SystemManagedGenericOAuthConfig[]),
    }),
    // Include SSO plugin when enabled
    ...(env.SSO_ENABLED
      ? [
          sso({
            domainVerification: { enabled: true },
            // Studio's invitations and seat checks own organization membership.
            organizationProvisioning: { disabled: true },
          }),
        ]
      : []),
    // Stripe is deployment-owned and env-backed; update it through deployment secrets.
    stripe({
      stripeClient,
      get stripeWebhookSecret() {
        return getStripeServiceConfig().webhookSecret ?? ''
      },
      createCustomerOnSignUp: false,
      subscription: {
        enabled: true,
        plans: getBetterAuthPlansConfig(),
        authorizeReference: async ({ user, referenceId }, context) => {
          const customerType = context.body?.customerType ?? context.query?.customerType
          if (customerType === 'organization') {
            return false
          }

          return await authorizeSubscriptionReference(user.id, {
            referenceType: 'organization',
            referenceId,
          })
        },
        getCheckoutSessionParams: async ({ subscription }) => {
          // An existing Stripe subscription changes plan in the portal. Reusing its row
          // for a new Checkout before its deletion is recorded would overwrite its Stripe ID.
          if (
            subscription.stripeSubscriptionId &&
            BILLING_ACTIVE_SUBSCRIPTION_STATUSES.some((status) => status === subscription.status)
          ) {
            throw new APIError('CONFLICT', {
              message: 'Subscription cancellation is still processing',
            })
          }
          const settings = await getResolvedSystemSettings()
          return {
            params: {
              allow_promotion_codes: settings.allowPromotionCodes,
              subscription_data: { billing_mode: { type: 'classic' } },
            },
          }
        },
        onSubscriptionComplete: async ({
          stripeSubscription,
          subscription,
        }: {
          stripeSubscription: Stripe.Subscription
          subscription: any
        }) => {
          logger.info('[onSubscriptionComplete] Subscription created', {
            subscriptionId: subscription.id,
            referenceType: subscription.referenceType,
            referenceId: subscription.referenceId,
            status: subscription.status,
          })

          await handleCompletedSubscription({
            subscriptionId: subscription.id,
            stripeSubscription,
          })
        },
      },
      onEvent: async (event: Stripe.Event) => {
        logger.info('[onEvent] Received Stripe webhook', {
          eventId: event.id,
          eventType: event.type,
        })

        try {
          switch (event.type) {
            case 'invoice.marked_uncollectible':
            case 'invoice.paid':
            case 'invoice.voided': {
              await handleInvoiceResolved(event)
              break
            }
            case 'invoice.payment_failed': {
              await handleInvoicePaymentFailed(event)
              break
            }
            case 'invoice.finalized': {
              await handleInvoiceFinalized(event)
              break
            }
            case 'customer.subscription.created': {
              await handleManualEnterpriseSubscription(event)
              break
            }
            case 'customer.subscription.updated': {
              await handleStripeSubscriptionUpdated(event)
              break
            }
            case 'customer.subscription.deleted': {
              await handleStripeSubscriptionDeleted(event)
              break
            }
            default:
              logger.info('[onEvent] Ignoring unsupported webhook event', {
                eventId: event.id,
                eventType: event.type,
              })
              break
          }

          logger.info('[onEvent] Successfully processed webhook', {
            eventId: event.id,
            eventType: event.type,
          })
        } catch (error) {
          logger.error('[onEvent] Failed to process webhook', {
            eventId: event.id,
            eventType: event.type,
            error,
          })
          throw error
        }
      },
    }),
    organization({
      allowUserToCreateOrganization: async (user) => {
        const [{ billingEnabled }, memberships] = await Promise.all([
          getBillingGateState(),
          db
            .select({ id: schema.member.id })
            .from(schema.member)
            .where(eq(schema.member.userId, user.id))
            .limit(1),
        ])

        return getOrganizationAccessState({
          billingEnabled,
          hasOrganization: memberships.length > 0,
          isOrganizationAdmin: false,
        }).canCreateOrganization
      },
      // Set a fixed membership limit of 50, but the actual limit will be enforced in the invitation flow
      membershipLimit: 50,
    }),
    nextCookies(),
  ],
  onAPIError: {
    errorURL: '/error',
  },
})

export async function getSession(headersOverride?: Headers) {
  const hdrs = headersOverride ?? (await headers())
  try {
    return await auth.api.getSession({
      headers: hdrs,
    })
  } catch (error) {
    logger.warn('Failed to fetch session', { error })
    return null
  }
}
