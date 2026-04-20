import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

/**
 * Universal environment variable getter that works in both client and server contexts.
 * - Client-side: Uses next-runtime-env for runtime injection (supports Docker runtime vars)
 * - Server-side: Falls back to process.env when runtimeEnv returns undefined
 * - Non-Next.js (e.g. React Email preview): Falls back to process.env directly
 *
 * next-runtime-env is loaded lazily to avoid crashes in non-Next.js contexts
 * where its internal `next/cache` dependency is unavailable.
 */
let _runtimeEnv: ((key: string) => string | undefined) | null | false = false

const getEnv = (variable: string) => {
  // Lazy-load next-runtime-env on first call
  if (_runtimeEnv === false) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _runtimeEnv = require('next-runtime-env').env
    } catch {
      _runtimeEnv = null
    }
  }

  if (_runtimeEnv) {
    try {
      return _runtimeEnv(variable) ?? process.env[variable]
    } catch {
      return process.env[variable]
    }
  }

  return process.env[variable]
}

// Wrap createEnv in a function so non-Next.js consumers (e.g. React Email preview)
// get a safe fallback instead of a top-level crash.
function safeCreateEnv() {
  try {
    // biome-ignore format: keep alignment for readability
    return createEnv({
  skipValidation: true,

  server: {
    // Core Database & Authentication
    DATABASE_URL: z.string().url(),                       // Primary database connection string
    BETTER_AUTH_URL: z.string().url(),                       // Base URL for Better Auth service
    BETTER_AUTH_SECRET: z.string().min(32),                     // Secret key for Better Auth JWT signing
    ALLOWED_LOGIN_EMAILS: z.string().optional(),                  // Comma-separated list of allowed email addresses for login
    ALLOWED_LOGIN_DOMAINS: z.string().optional(),                  // Comma-separated list of allowed email domains for login
    ENCRYPTION_KEY: z.string().min(32),                     // Key for encrypting sensitive data
    API_ENCRYPTION_KEY: z.string().min(32).optional(),          // Dedicated key for encrypting API keys (optional for OSS)
    INTERNAL_API_SECRET: z.string().min(32),                     // Secret for internal API authentication

    // Database & Storage
    REDIS_URL: z.string().url().optional(),            // Redis connection string for caching/sessions

    // Email & Communication
    EMAIL_VERIFICATION_ENABLED: z.boolean().optional(),                 // Enable email verification for user registration and login (defaults to false)

    // SMS & Messaging
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),           // Twilio Account SID for SMS sending
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),           // Twilio Auth Token for API authentication
    TWILIO_PHONE_NUMBER: z.string().min(1).optional(),           // Twilio phone number for sending SMS

    // AI/LLM feature flags
    DEEPSEEK_MODELS_ENABLED: z.boolean().optional().default(false),  // Enable Deepseek models in UI (defaults to false for compliance)

    // Monitoring & Analytics
    TELEMETRY_ENDPOINT: z.string().url().optional(),            // Custom telemetry/analytics endpoint
    LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(), // Minimum log level to display (defaults to ERROR in production, DEBUG in development)

    // Infrastructure & Deployment
    NEXT_RUNTIME: z.string().optional(),                  // Next.js runtime environment
    DOCKER_BUILD: z.boolean().optional(),                 // Flag indicating Docker build environment

    // Background Jobs & Scheduling
    TRIGGER_PROJECT_ID: z.string().optional(),                  // Trigger.dev project ID
    TRIGGER_SECRET_KEY: z.string().min(1).optional(),           // Trigger.dev secret key for background jobs
    CRON_SECRET: z.string().optional(),                  // Secret for authenticating cron job requests

    // Cloud Storage - AWS S3
    STORAGE_PROVIDER: z.enum(['local', 's3', 'azure', 'vercel']).optional(),                  // Explicit storage provider override
    AWS_REGION: z.string().optional(),                  // AWS region for S3 buckets
    AWS_ACCESS_KEY_ID: z.string().optional(),                  // AWS access key ID
    AWS_SECRET_ACCESS_KEY: z.string().optional(),                  // AWS secret access key
    S3_BUCKET_NAME: z.string().optional(),                  // S3 bucket for general file storage
    S3_KB_BUCKET_NAME: z.string().optional(),                  // S3 bucket for knowledge base files
    S3_EXECUTION_FILES_BUCKET_NAME: z.string().optional(),                  // S3 bucket for workflow execution files
    S3_CHAT_BUCKET_NAME: z.string().optional(),                  // S3 bucket for chat logos
    S3_COPILOT_BUCKET_NAME: z.string().optional(),                  // S3 bucket for copilot files
    S3_PROFILE_PICTURES_BUCKET_NAME: z.string().optional(),                  // S3 bucket for profile pictures

    // Cloud Storage - Azure 
    AZURE_ACCOUNT_NAME: z.string().optional(),                  // Azure storage account name
    AZURE_ACCOUNT_KEY: z.string().optional(),                  // Azure storage account key
    AZURE_CONNECTION_STRING: z.string().optional(),                  // Azure storage connection string
    AZURE_STORAGE_CONTAINER_NAME: z.string().optional(),                  // Azure container for general files
    AZURE_STORAGE_KB_CONTAINER_NAME: z.string().optional(),                  // Azure container for knowledge base files
    AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME: z.string().optional(),          // Azure container for workflow execution files
    AZURE_STORAGE_CHAT_CONTAINER_NAME: z.string().optional(),                  // Azure container for chat logos
    AZURE_STORAGE_COPILOT_CONTAINER_NAME: z.string().optional(),                  // Azure container for copilot files
    AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME: z.string().optional(),          // Azure container for profile pictures

    // Cloud Storage - Vercel Blob
    BLOB_READ_WRITE_TOKEN: z.string().optional(),                  // Default Vercel Blob read-write token
    VERCEL_BLOB_READ_WRITE_TOKEN: z.string().optional(),                  // Custom-named Vercel Blob read-write token
    VERCEL_BLOB_ACCESS: z.enum(['public', 'private']).optional(),                  // Vercel Blob access mode

    // Knowledge Base Processing Configuration - Shared across all processing methods
    KB_CONFIG_MAX_DURATION: z.number().optional().default(600),     // Max processing duration in seconds (10 minutes)
    KB_CONFIG_MAX_ATTEMPTS: z.number().optional().default(3),       // Max retry attempts
    KB_CONFIG_RETRY_FACTOR: z.number().optional().default(2),       // Retry backoff factor
    KB_CONFIG_MIN_TIMEOUT: z.number().optional().default(1000),    // Min timeout in ms
    KB_CONFIG_MAX_TIMEOUT: z.number().optional().default(10000),   // Max timeout in ms
    KB_CONFIG_CONCURRENCY_LIMIT: z.number().optional().default(20),      // Queue concurrency limit
    KB_CONFIG_BATCH_SIZE: z.number().optional().default(20),      // Processing batch size
    KB_CONFIG_DELAY_BETWEEN_BATCHES: z.number().optional().default(100),     // Delay between batches in ms
    KB_CONFIG_DELAY_BETWEEN_DOCUMENTS: z.number().optional().default(50),      // Delay between documents in ms

    // Real-time Communication
    SOCKET_PORT: z.number().optional(),                  // Port for the realtime socket server process
    PORT: z.number().optional(),                  // Main application port
    ALLOWED_ORIGINS: z.string().optional(),                  // CORS allowed origins

    // SSO Configuration
    SSO_ENABLED: z.boolean().optional(),                 // Enable SSO functionality

    // Social Login (env-only Better Auth providers)
    GOOGLE_CLIENT_ID: z.string().optional(),                  // Google social login OAuth client ID
    GOOGLE_CLIENT_SECRET: z.string().optional(),              // Google social login OAuth client secret
    GITHUB_CLIENT_ID: z.string().optional(),                  // GitHub social login OAuth client ID
    GITHUB_CLIENT_SECRET: z.string().optional(),              // GitHub social login OAuth client secret

    // Deployment-owned billing configuration
    STRIPE_SECRET_KEY: z.string().min(1).optional(),         // Stripe secret key for server-side API requests
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),     // Stripe webhook signing secret for webhook verification
  },

  client: {
    // Core Application URLs - Required for frontend functionality
    NEXT_PUBLIC_APP_URL: z.string().url(),                       // Base URL of the application (e.g., https://app.tradinggoose.ai)

    // Client-side Services
    NEXT_PUBLIC_SOCKET_URL: z.string().url().optional(),            // Optional realtime URL; defaults to http://localhost:3002 when unset

    // Google Services - For client-side Google integrations
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),                  // Google OAuth client ID for browser auth

    // Analytics & Tracking
    NEXT_PUBLIC_GOOGLE_API_KEY: z.string().optional(),                  // Google API key for client-side API calls
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: z.string().optional(),                  // Google project number for Drive picker
    NEXT_PUBLIC_POSTHOG_DISABLED: z.string().optional(),                 // Set to "1" to disable PostHog analytics
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),                  // PostHog project API key

    // Feature Flags
    NEXT_PUBLIC_SSO_ENABLED: z.boolean().optional(),                 // Enable SSO login UI components
  },

  // Variables available on both server and client
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(), // Runtime environment
    NEXT_TELEMETRY_DISABLED: z.string().optional(),                // Disable Next.js telemetry collection
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    NEXT_PUBLIC_SSO_ENABLED: process.env.NEXT_PUBLIC_SSO_ENABLED,
    NEXT_PUBLIC_POSTHOG_DISABLED: process.env.NEXT_PUBLIC_POSTHOG_DISABLED,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
  },
})
  } catch {
    // Non-Next.js context (e.g. React Email preview) — return a proxy
    // that reads from process.env directly.
    return new Proxy({} as any, {
      get(_, prop) {
        if (typeof prop === 'string') return process.env[prop]
        return undefined
      },
    })
  }
}

export const env = safeCreateEnv()

// Need this utility because t3-env is returning string for boolean values.
export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

// Utility to check if a value is explicitly false (defaults to false only if explicitly set)
export const isFalsy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false

export { getEnv }
