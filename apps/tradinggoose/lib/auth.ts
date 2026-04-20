import { sso } from '@better-auth/sso'
import { stripe } from '@better-auth/stripe'
import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import {
  customSession,
  emailOTP,
  genericOAuth,
  oneTimeToken,
  organization,
} from 'better-auth/plugins'
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'

/** OAuth2 token type extracted from better-auth's GenericOAuthConfig */
type OAuthTokens = Parameters<NonNullable<GenericOAuthConfig['getUserInfo']>>[0]

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderInvitationEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
} from '@/components/emails/render-email'
import { sendBillingTierWelcomeEmail } from '@/lib/billing'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import {
  ensureDefaultUserSubscription,
  getEffectiveSubscription,
} from '@/lib/billing/core/subscription'
import { handleNewUser } from '@/lib/billing/core/usage'
import {
  ensureOrganizationForOrganizationSubscription,
  syncSubscriptionUsageLimits,
} from '@/lib/billing/organization'
import { getBetterAuthPlansConfig } from '@/lib/billing/plans'
import { getBillingGateState } from '@/lib/billing/settings'
import { hydrateSubscriptionsWithTiers, requireBillingTierById } from '@/lib/billing/tiers'
import { syncSubscriptionBillingTierFromStripeSubscription } from '@/lib/billing/tiers/persistence'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import {
  handleInvoiceFinalized,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
} from '@/lib/billing/webhooks/invoices'
import {
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
} from '@/lib/billing/webhooks/subscription'
import { sendEmail } from '@/lib/email/mailer'
import { quickValidateEmail } from '@/lib/email/validation'
import { env, getEnv } from '@/lib/env'
import { isEmailVerificationEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getCanonicalScopesForProvider,
  getMicrosoftRefreshTokenExpiry,
  HUBSPOT_OAUTH_SCOPES,
  isMicrosoftProvider,
  MICROSOFT_PROVIDERS,
  OAUTH_PROVIDERS,
} from '@/lib/oauth'
import { getSystemOAuthClientCredentialsForRequest } from '@/lib/oauth/system-managed-config'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getRegistrationEligibility, markWaitlistEntrySignedUp } from '@/lib/registration/service'
import {
  REGISTRATION_DISABLED_MESSAGE,
  REGISTRATION_WAITLIST_MESSAGE,
} from '@/lib/registration/shared'
import {
  createStripeClientProxy,
  getStripeServiceConfig,
  hasStripeSecretKey,
} from '@/lib/system-services/stripe-runtime'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'
import { getBaseUrl } from '@/lib/urls/utils'
import { SSO_TRUSTED_PROVIDERS } from './sso/consts'

const logger = createLogger('Auth')

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
    ...Object.entries(OAUTH_PROVIDERS).flatMap(([baseProvider, providerConfig]) =>
      BASE_TRUSTED_OAUTH_PROVIDERS.includes(baseProvider)
        ? Object.values(providerConfig.services).map((service) => service.providerId)
        : []
    ),
  ])
)

async function getHydratedSubscriptionById(subscriptionId: string) {
  const rows = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.id, subscriptionId))
    .limit(1)

  const hydratedSubscriptions = await hydrateSubscriptionsWithTiers(rows)
  return hydratedSubscriptions[0] ?? null
}

type SystemManagedGenericOAuthConfig = Omit<GenericOAuthConfig, 'clientId' | 'clientSecret'>
type EnvBackedSocialProviderConfig = {
  clientId: string
  clientSecret: string
}

function toSystemManagedGenericOAuthConfig(
  config: SystemManagedGenericOAuthConfig
): GenericOAuthConfig {
  const providerConfig = {
    ...config,
    clientId: '',
    clientSecret: '',
  } satisfies GenericOAuthConfig

  Object.defineProperties(providerConfig, {
    clientId: {
      enumerable: true,
      configurable: true,
      get() {
        return getSystemOAuthClientCredentialsForRequest(config.providerId).clientId
      },
    },
    clientSecret: {
      enumerable: true,
      configurable: true,
      get() {
        return getSystemOAuthClientCredentialsForRequest(config.providerId).clientSecret
      },
    },
  })

  return providerConfig
}

function toSystemManagedGenericOAuthConfigs(configs: SystemManagedGenericOAuthConfig[]) {
  return configs.map((config) => toSystemManagedGenericOAuthConfig(config))
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
    redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/${providerId}`,
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

  const now = new Date()
  return {
    id: `${payload.oid || payload.sub}-${crypto.randomUUID()}`,
    name: (payload.name as string) || 'Microsoft User',
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  }
}

const stripeClient = createStripeClientProxy()

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  trustedOrigins: [
    getBaseUrl(),
    getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002',
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 24 * 60 * 60, // 24 hours in seconds
    },
    expiresIn: 30 * 24 * 60 * 60, // 30 days (how long a session can last overall)
    updateAge: 24 * 60 * 60, // 24 hours (how often to refresh the expiry)
    freshAge: 60 * 60, // 1 hour (or set to 0 to disable completely)
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const eligibility = await getRegistrationEligibility(user.email)
          if (eligibility.allowed) {
            return
          }

          throw new APIError('BAD_REQUEST', {
            message:
              eligibility.reason === 'disabled'
                ? REGISTRATION_DISABLED_MESSAGE
                : REGISTRATION_WAITLIST_MESSAGE,
          })
        },
        after: async (user) => {
          logger.info('[databaseHooks.user.create.after] User created, initializing stats', {
            userId: user.id,
          })

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
        },
      },
    },
    account: {
      create: {
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
    },
    session: {
      create: {
        before: async (session) => {
          try {
            // Find the first organization this user is a member of
            const members = await db
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
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: [
        // Standard OAuth providers
        ...TRUSTED_OAUTH_PROVIDER_IDS,

        // Common SSO provider patterns
        ...SSO_TRUSTED_PROVIDERS,
      ],
    },
  },
  socialProviders: buildSocialProviders(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailVerificationEnabled,
    sendVerificationOnSignUp: false,
    throwOnMissingCredentials: true,
    throwOnInvalidCredentials: true,
    sendResetPassword: async ({ user, url, token }, request) => {
      const username = user.name || ''

      const html = await renderPasswordResetEmail(username, url)

      const result = await sendEmail({
        to: user.email,
        subject: getEmailSubject('reset-password'),
        html,
        emailType: 'transactional',
      })

      if (!result.success) {
        throw new Error(`Failed to send reset password email: ${result.message}`)
      }
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (
        (ctx.path.startsWith('/sign-in') || ctx.path.startsWith('/sign-up')) &&
        (env.ALLOWED_LOGIN_EMAILS || env.ALLOWED_LOGIN_DOMAINS)
      ) {
        const requestEmail = ctx.body?.email?.toLowerCase()

        if (requestEmail) {
          let isAllowed = false

          if (env.ALLOWED_LOGIN_EMAILS) {
            const allowedEmails = env.ALLOWED_LOGIN_EMAILS.split(',').map((email: string) =>
              email.trim().toLowerCase()
            )
            isAllowed = allowedEmails.includes(requestEmail)
          }

          if (!isAllowed && env.ALLOWED_LOGIN_DOMAINS) {
            const allowedDomains = env.ALLOWED_LOGIN_DOMAINS.split(',').map((domain: string) =>
              domain.trim().toLowerCase()
            )
            const emailDomain = requestEmail.split('@')[1]
            isAllowed = emailDomain && allowedDomains.includes(emailDomain)
          }

          if (!isAllowed) {
            throw new Error('Access restricted. Please contact your administrator.')
          }
        }
      }

      return
    }),
  },
  plugins: [
    nextCookies(),
    oneTimeToken({
      expiresIn: 24 * 60 * 60, // 24 hours - Socket.IO handles connection persistence with heartbeats
    }),
    customSession(async ({ user, session }) => ({
      user,
      session,
    })),
    emailOTP({
      sendVerificationOTP: async (data: {
        email: string
        otp: string
        type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'
      }) => {
        if (!isEmailVerificationEnabled) {
          logger.info('Skipping email verification')
          return
        }
        try {
          if (!data.email) {
            throw new Error('Email is required')
          }

          const validation = quickValidateEmail(data.email)
          if (!validation.isValid) {
            logger.warn('Email validation failed', {
              email: data.email,
              reason: validation.reason,
              checks: validation.checks,
            })
            throw new Error(
              validation.reason ||
                "We are unable to deliver the verification email to that address. Please make sure it's valid and able to receive emails."
            )
          }

          const html = await renderOTPEmail(data.otp, data.email, data.type)

          const result = await sendEmail({
            to: data.email,
            subject: getEmailSubject(data.type),
            html,
            emailType: 'transactional',
          })

          if (!result.success && result.message.includes('no email service configured')) {
            logger.info('🔑 VERIFICATION CODE FOR LOGIN/SIGNUP', {
              email: data.email,
              otp: data.otp,
              type: data.type,
              validation: validation.checks,
            })
            return
          }

          if (!result.success) {
            throw new Error(`Failed to send verification code: ${result.message}`)
          }
        } catch (error) {
          logger.error('Error sending verification code:', {
            error,
            email: data.email,
          })
          throw error
        }
      },
      sendVerificationOnSignUp: false,
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
    }),
    genericOAuth({
      config: toSystemManagedGenericOAuthConfigs([
        {
          providerId: 'alpaca',
          authorizationUrl: 'https://app.alpaca.markets/oauth/authorize',
          tokenUrl: 'https://api.alpaca.markets/oauth/token',
          scopes: ['account:write', 'trading', 'data'],
          getUserInfo: async (tokens) => {
            // Access provider-specific fields from raw token data
            const options = {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            }
            const response = await fetch('https://paper-api.alpaca.markets/v2/account', options)
            const data = await response.json()
            return {
              id: data.id,
              name: data.account_number,
              email: data.account_number,
              image: '',
              emailVerified: false,
            }
          },
          responseType: 'code',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/alpaca`,
        },
        {
          providerId: 'github-repo',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          accessType: 'offline',
          prompt: 'consent',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'repo', 'read:user', 'workflow'],
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/github-repo`,
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

        // Google providers
        {
          providerId: 'google-email',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.labels',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-email`,
        },
        {
          providerId: 'google-calendar',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/calendar',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-calendar`,
        },
        {
          providerId: 'google-drive',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-drive`,
        },
        {
          providerId: 'google-docs',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-docs`,
        },
        {
          providerId: 'google-sheets',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-sheets`,
        },

        {
          providerId: 'google-forms',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/forms.responses.readonly',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-forms`,
        },

        {
          providerId: 'google-vault',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/ediscovery',
            'https://www.googleapis.com/auth/devstorage.read_only',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-vault`,
        },

        ...[...MICROSOFT_PROVIDERS].map(createMicrosoftOAuthProvider),

        {
          providerId: 'wealthbox',
          authorizationUrl: 'https://app.crmworkspace.com/oauth/authorize',
          tokenUrl: 'https://app.crmworkspace.com/oauth/token',
          userInfoUrl: 'https://dummy-not-used.wealthbox.com', // Dummy URL since no user info endpoint exists
          scopes: ['login', 'data'],
          responseType: 'code',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/wealthbox`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Wealthbox user profile from token data')

              const uniqueId = `wealthbox-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Wealthbox User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@wealthbox.user`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error creating Wealthbox user profile:', { error })
              return null
            }
          },
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/supabase`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/x`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/confluence`,
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
          scopes: ['identify', 'bot', 'messages.read', 'guilds', 'guilds.members.read'],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/discord`,
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
                email: profile.email || `${profile.id}@discord.user`,
                image: profile.avatar
                  ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                  : undefined,
                emailVerified: profile.verified || false,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/jira`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/airtable`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/notion`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/reddit`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/linear`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/slack`,
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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/webflow`,
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

              const userId = data.user_id || `webflow-${Date.now()}`
              const uniqueId = `webflow-${userId}`

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
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/hubspot`,
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
    ...(env.SSO_ENABLED ? [sso()] : []),
    // Stripe is deployment-owned and env-backed; update it through deployment secrets.
    stripe({
      stripeClient,
      get stripeWebhookSecret() {
        return getStripeServiceConfig().webhookSecret ?? ''
      },
      get createCustomerOnSignUp() {
        return hasStripeSecretKey()
      },
      onCustomerCreate: async ({ stripeCustomer, user }) => {
        logger.info('[onCustomerCreate] Stripe customer created', {
          stripeCustomerId: stripeCustomer.id,
          userId: user.id,
        })
      },
      subscription: {
        enabled: true,
        plans: getBetterAuthPlansConfig(),
        authorizeReference: async ({ user, referenceId }) => {
          return await authorizeSubscriptionReference(user.id, referenceId)
        },
        getCheckoutSessionParams: async ({ plan, subscription }) => {
          const [settings, tier] = await Promise.all([
            getResolvedSystemSettings(),
            requireBillingTierById(plan.name),
          ])
          const allowPromotionCodes = settings.allowPromotionCodes

          if (tier.ownerType === 'organization') {
            const seatCount = tier.seatCount ?? 1
            const checkoutQuantity = Math.max(subscription?.seats || seatCount, seatCount, 1)

            return {
              params: {
                allow_promotion_codes: allowPromotionCodes,
                line_items: [
                  {
                    price: plan.priceId,
                    quantity: checkoutQuantity,
                    ...(tier.seatMode === 'adjustable'
                      ? {
                          adjustable_quantity: {
                            enabled: true,
                            minimum: seatCount,
                            ...(typeof tier.seatMaximum === 'number'
                              ? { maximum: tier.seatMaximum }
                              : {}),
                          },
                        }
                      : {}),
                  },
                ],
              },
            }
          }

          return {
            params: {
              allow_promotion_codes: allowPromotionCodes,
            },
          }
        },
        onSubscriptionComplete: async ({
          event,
          stripeSubscription,
          subscription,
        }: {
          event: Stripe.Event
          stripeSubscription: Stripe.Subscription
          subscription: any
        }) => {
          logger.info('[onSubscriptionComplete] Subscription created', {
            subscriptionId: subscription.id,
            referenceType: subscription.referenceType,
            referenceId: subscription.referenceId,
            status: subscription.status,
          })

          await syncSubscriptionBillingTierFromStripeSubscription(
            subscription.id,
            stripeSubscription || (event.data.object as Stripe.Subscription | undefined)
          )

          const hydratedSubscription = await getHydratedSubscriptionById(subscription.id)
          const subscriptionRecord = hydratedSubscription ?? { ...subscription, tier: null }
          const resolvedSubscription =
            await ensureOrganizationForOrganizationSubscription(subscriptionRecord)

          await handleSubscriptionCreated(resolvedSubscription)

          await syncSubscriptionUsageLimits(resolvedSubscription)

          await sendBillingTierWelcomeEmail(resolvedSubscription)
        },
        onSubscriptionUpdate: async ({
          event,
          subscription,
        }: {
          event: Stripe.Event
          subscription: any
        }) => {
          logger.info('[onSubscriptionUpdate] Subscription updated', {
            subscriptionId: subscription.id,
            status: subscription.status,
          })

          await syncSubscriptionBillingTierFromStripeSubscription(
            subscription.id,
            event.data.object as Stripe.Subscription | undefined
          )

          const hydratedSubscription = await getHydratedSubscriptionById(subscription.id)
          const subscriptionRecord = hydratedSubscription ?? { ...subscription, tier: null }
          const resolvedSubscription =
            await ensureOrganizationForOrganizationSubscription(subscriptionRecord)

          try {
            await syncSubscriptionUsageLimits(resolvedSubscription)
          } catch (error) {
            logger.error('[onSubscriptionUpdate] Failed to sync usage limits', {
              subscriptionId: subscription.id,
              referenceType: resolvedSubscription.referenceType,
              referenceId: resolvedSubscription.referenceId,
              error,
            })
          }
        },
        onSubscriptionDeleted: async ({
          event,
          stripeSubscription,
          subscription,
        }: {
          event: Stripe.Event
          stripeSubscription: Stripe.Subscription
          subscription: any
        }) => {
          logger.info('[onSubscriptionDeleted] Subscription deleted', {
            subscriptionId: subscription.id,
            referenceType: subscription.referenceType,
            referenceId: subscription.referenceId,
          })

          try {
            await syncSubscriptionBillingTierFromStripeSubscription(
              subscription.id,
              stripeSubscription || (event.data.object as Stripe.Subscription | undefined)
            )

            const hydratedSubscription = await getHydratedSubscriptionById(subscription.id)
            const subscriptionRecord = hydratedSubscription ?? { ...subscription, tier: null }

            await handleSubscriptionDeleted(subscriptionRecord)

            const { billingEnabled } = await getBillingGateState()
            const nextSubscriptionRecord =
              billingEnabled && subscriptionRecord.referenceType === 'user'
                ? await ensureDefaultUserSubscription(subscriptionRecord.referenceId)
                : subscriptionRecord

            await syncSubscriptionUsageLimits(nextSubscriptionRecord)

            logger.info('[onSubscriptionDeleted] Reconciled subscription usage limits', {
              subscriptionId: subscription.id,
              referenceType: subscription.referenceType,
              referenceId: subscription.referenceId,
            })
          } catch (error) {
            logger.error('[onSubscriptionDeleted] Failed to handle subscription deletion', {
              subscriptionId: subscription.id,
              referenceType: subscription.referenceType,
              referenceId: subscription.referenceId,
              error,
            })
          }
        },
      },
      onEvent: async (event: Stripe.Event) => {
        logger.info('[onEvent] Received Stripe webhook', {
          eventId: event.id,
          eventType: event.type,
        })

        try {
          switch (event.type) {
            case 'invoice.payment_succeeded': {
              await handleInvoicePaymentSucceeded(event)
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
            // Note: customer.subscription.deleted is handled by better-auth's onSubscriptionDeleted callback above
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
        const [{ billingEnabled }, personalSubscription, memberships] = await Promise.all([
          getBillingGateState(),
          getEffectiveSubscription(user.id),
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
          userTier: personalSubscription?.tier,
        }).canCreateOrganization
      },
      // Set a fixed membership limit of 50, but the actual limit will be enforced in the invitation flow
      membershipLimit: 50,
      // Validate seat limits before sending invitations
      beforeInvite: async ({ organization }: { organization: { id: string } }) => {
        const seatValidation = await validateSeatAvailability(organization.id)

        if (!seatValidation.canInvite) {
          throw new Error(seatValidation.reason ?? 'Unable to invite member')
        }
      },
      sendInvitationEmail: async (data: any) => {
        try {
          const { invitation, organization, inviter } = data

          const inviteUrl = `${getBaseUrl()}/invite/${invitation.id}`
          const inviterName = inviter.user?.name || 'A team member'

          const html = await renderInvitationEmail(
            inviterName,
            organization.name,
            inviteUrl,
            invitation.email
          )

          const result = await sendEmail({
            to: invitation.email,
            subject: `${inviterName} has invited you to join ${organization.name} on TradingGoose`,
            html,
            emailType: 'transactional',
          })

          if (!result.success) {
            logger.error('Failed to send organization invitation email:', result.message)
          }
        } catch (error) {
          logger.error('Error sending invitation email', { error })
        }
      },
      organizationCreation: {
        afterCreate: async ({
          organization,
          user,
        }: {
          organization: { id: string }
          user: { id: string }
        }) => {
          logger.info('[organizationCreation.afterCreate] Organization created', {
            organizationId: organization.id,
            creatorId: user.id,
          })
        },
      },
    }),
  ],
  onAPIError: {
    errorURL: '/error',
  },
  pages: {
    signIn: '/login',
    signUp: '/signup',
    error: '/error',
    verify: '/verify',
  },
})

export async function getSession(
  headersOverride?: Headers,
  options?: { disableCookieCache?: boolean }
) {
  const hdrs = headersOverride ?? (await headers())
  try {
    return await auth.api.getSession({
      headers: hdrs,
      ...(options ? { query: options } : {}),
    })
  } catch (error) {
    logger.warn('Failed to fetch session', { error })
    return null
  }
}

export const signIn = auth.api.signInEmail
export const signUp = auth.api.signUpEmail
