import { env, getEnv } from '../env'
import { MARKET_API_URL_DEFAULT } from '../market/client/constants'

/**
 * Content Security Policy (CSP) configuration builder
 */

function getUrlOrigin(url: string | undefined, fallback?: string): string | null {
  const candidate = url?.trim() || fallback
  if (!candidate) return null
  try {
    return new URL(candidate).origin
  } catch {
    if (!fallback || candidate === fallback) return null
    try {
      return new URL(fallback).origin
    } catch {
      return null
    }
  }
}

function getOriginFromUrl(url: string | undefined, fallback?: string): string[] {
  const origin = getUrlOrigin(url, fallback)
  return origin ? [origin] : []
}

function getSocketSourcesFromUrl(url: string | undefined, fallback = 'http://localhost:3002'): string[] {
  const candidate = url?.trim() || fallback
  if (!candidate) return []
  try {
    const parsed = new URL(candidate)
    const sources = new Set<string>([parsed.origin])

    if (parsed.protocol === 'http:') {
      sources.add(`ws://${parsed.host}`)
    } else if (parsed.protocol === 'https:') {
      sources.add(`wss://${parsed.host}`)
    } else if (parsed.protocol === 'ws:') {
      sources.add(`http://${parsed.host}`)
    } else if (parsed.protocol === 'wss:') {
      sources.add(`https://${parsed.host}`)
    }

    return [...sources]
  } catch {
    if (!fallback || candidate === fallback) return []
    return getSocketSourcesFromUrl(fallback)
  }
}

export interface CSPDirectives {
  'default-src'?: string[]
  'script-src'?: string[]
  'style-src'?: string[]
  'img-src'?: string[]
  'media-src'?: string[]
  'font-src'?: string[]
  'connect-src'?: string[]
  'worker-src'?: string[]
  'frame-src'?: string[]
  'frame-ancestors'?: string[]
  'form-action'?: string[]
  'base-uri'?: string[]
  'object-src'?: string[]
}

// Build-time CSP directives (for next.config.ts)
export const buildTimeCSPDirectives: CSPDirectives = {
  'default-src': ["'self'"],

  'script-src': [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    'https://*.google.com',
    'https://apis.google.com',
  ],

  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],

  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://*.googleusercontent.com',
    'https://*.google.com',
    'https://*.atlassian.com',
    'https://cdn.discordapp.com',
    'https://cdn.jsdelivr.net',
    'https://*.githubusercontent.com',
    'https://*.s3.amazonaws.com',
    'https://s3.amazonaws.com',
    'https://github.com/*',
    ...(env.S3_BUCKET_NAME && env.AWS_REGION
      ? getOriginFromUrl(`https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`)
      : []),
    ...(env.S3_KB_BUCKET_NAME && env.AWS_REGION
      ? getOriginFromUrl(`https://${env.S3_KB_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`)
      : []),
    ...(env.S3_CHAT_BUCKET_NAME && env.AWS_REGION
      ? getOriginFromUrl(`https://${env.S3_CHAT_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`)
      : []),
    'https://*.amazonaws.com',
    'https://*.blob.core.windows.net',
    'https://github.com/*',
    ...getOriginFromUrl(MARKET_API_URL_DEFAULT),
    ...(env.NODE_ENV === 'development' ? getOriginFromUrl('http://localhost:3001') : []),
  ],

  'media-src': ["'self'", 'blob:'],

  'font-src': ["'self'", 'https://fonts.gstatic.com'],

  'connect-src': [
    "'self'",
    ...getOriginFromUrl(env.NEXT_PUBLIC_APP_URL),
    ...getSocketSourcesFromUrl(env.NEXT_PUBLIC_SOCKET_URL),
    ...getOriginFromUrl('http://localhost:11434'),
    'https://api.browser-use.com',
    'https://api.exa.ai',
    'https://api.firecrawl.dev',
    'https://*.googleapis.com',
    'https://*.amazonaws.com',
    'https://*.s3.amazonaws.com',
    'https://*.blob.core.windows.net',
    'https://*.atlassian.com',
    'https://*.supabase.co',
    'https://api.github.com',
    'https://github.com/*',
    ...getOriginFromUrl(MARKET_API_URL_DEFAULT),
    ...(env.NODE_ENV === 'development' ? getOriginFromUrl('http://localhost:3001') : []),
  ],

  'worker-src': ["'self'", 'blob:'],

  'frame-src': ['https://drive.google.com', 'https://docs.google.com', 'https://*.google.com'],

  'frame-ancestors': ["'self'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
}

/**
 * Build CSP string from directives object
 */
export function buildCSPString(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([directive, sources]) => {
      if (!sources || sources.length === 0) return ''
      const validSources = sources.filter((source: string | undefined): source is string => {
        if (typeof source !== 'string') return false
        const normalized = source.trim()
        return normalized !== '' && normalized !== 'undefined' && normalized !== 'null'
      })
      if (validSources.length === 0) return ''
      return `${directive} ${validSources.join(' ')}`
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Generate runtime CSP header from explicit allowlisted origins.
 * This runs inside middleware/proxy, so it uses request-time env values but avoids broad scheme
 * relaxations and filters invalid values before serialization.
 */
export async function generateRuntimeCSP(): Promise<string> {
  const runtimeCSP: CSPDirectives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      'https://*.google.com',
      'https://apis.google.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://*.googleusercontent.com',
      'https://*.google.com',
      'https://*.atlassian.com',
      'https://cdn.discordapp.com',
      'https://cdn.jsdelivr.net',
      'https://*.githubusercontent.com',
      'https://*.s3.amazonaws.com',
      'https://s3.amazonaws.com',
      'https://*.amazonaws.com',
      'https://*.blob.core.windows.net',
      'https://github.com/*',
      ...getOriginFromUrl(MARKET_API_URL_DEFAULT),
      ...(getEnv('NODE_ENV') === 'development' ? getOriginFromUrl('http://localhost:3001') : []),
    ],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'connect-src': [
      "'self'",
      ...getOriginFromUrl(getEnv('NEXT_PUBLIC_APP_URL')),
      ...getSocketSourcesFromUrl(getEnv('NEXT_PUBLIC_SOCKET_URL')),
      ...getOriginFromUrl('http://localhost:11434'),
      ...getOriginFromUrl(MARKET_API_URL_DEFAULT),
      ...(getEnv('NODE_ENV') === 'development' ? getOriginFromUrl('http://localhost:3001') : []),
      'https://api.browser-use.com',
      'https://api.exa.ai',
      'https://api.firecrawl.dev',
      'https://*.googleapis.com',
      'https://*.amazonaws.com',
      'https://*.s3.amazonaws.com',
      'https://*.blob.core.windows.net',
      'https://api.github.com',
      'https://github.com/*',
      'https://*.atlassian.com',
      'https://*.supabase.co',
    ],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': [
      'https://drive.google.com',
      'https://docs.google.com',
      'https://*.google.com',
    ],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  }

  return buildCSPString(runtimeCSP)
}

/**
 * Get the main CSP policy string (build-time)
 */
export function getMainCSPPolicy(): string {
  return buildCSPString(buildTimeCSPDirectives)
}

/**
 * Permissive CSP for workflow execution endpoints
 */
export function getWorkflowExecutionCSPPolicy(): string {
  return "default-src * 'unsafe-inline' 'unsafe-eval'; connect-src *;"
}

/**
 * Add a source to a specific directive (modifies build-time directives)
 */
export function addCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (!buildTimeCSPDirectives[directive]) {
    buildTimeCSPDirectives[directive] = []
  }
  if (!buildTimeCSPDirectives[directive]!.includes(source)) {
    buildTimeCSPDirectives[directive]!.push(source)
  }
}

/**
 * Remove a source from a specific directive (modifies build-time directives)
 */
export function removeCSPSource(directive: keyof CSPDirectives, source: string): void {
  if (buildTimeCSPDirectives[directive]) {
    buildTimeCSPDirectives[directive] = buildTimeCSPDirectives[directive]!.filter(
      (s: string) => s !== source
    )
  }
}
