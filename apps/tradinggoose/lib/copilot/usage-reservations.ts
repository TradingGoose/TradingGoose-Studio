import crypto from 'node:crypto'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import {
  acquireLock,
  deleteCachedValue,
  getCachedValue,
  releaseLock,
  setCachedValue,
} from '@/lib/redis'

const logger = createLogger('CopilotUsageReservations')

type ReservationScopeType = 'user' | 'organization' | 'organization_member'

type ReservationScope = {
  scopeType: ReservationScopeType
  scopeId: string
}

type CopilotUsageReservation = {
  id: string
  userId: string
  workflowId: string | null
  scopeType: ReservationScopeType
  scopeId: string
  reservedUsd: number
  reason: string
  createdAt: string
  expiresAt: string
}

type ReservationLookup = {
  scopeType: ReservationScopeType
  scopeId: string
}

export type CopilotUsageReservationResult = {
  allowed: boolean
  status: number
  reservationId?: string
  reservedUsd?: number
  currentUsage: number
  limit: number
  remaining: number
  activeReservedUsd: number
  scopeType: ReservationScopeType
  scopeId: string
  message?: string
  expiresAt?: string
}

export type CopilotUsageReleaseResult = {
  released: boolean
  reservationId: string
  reservedUsd?: number
  scopeType?: ReservationScopeType
  scopeId?: string
}

const RESERVATION_KEY_PREFIX = 'copilot:usage-reservation'
const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60
const DEFAULT_LOCK_TTL_SECONDS = 10

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const RESERVATION_TTL_SECONDS = parsePositiveInt(
  process.env.COPILOT_USAGE_RESERVATION_TTL_SECONDS,
  DEFAULT_RESERVATION_TTL_SECONDS
)
const LOCK_TTL_SECONDS = parsePositiveInt(
  process.env.COPILOT_USAGE_RESERVATION_LOCK_TTL_SECONDS,
  DEFAULT_LOCK_TTL_SECONDS
)

function getScopeCacheKey(scope: ReservationScope): string {
  return `${RESERVATION_KEY_PREFIX}:scope:${scope.scopeType}:${scope.scopeId}`
}

function getReservationLookupKey(reservationId: string): string {
  return `${RESERVATION_KEY_PREFIX}:id:${reservationId}`
}

function getScopeLockKey(scope: ReservationScope): string {
  return `${RESERVATION_KEY_PREFIX}:lock:${scope.scopeType}:${scope.scopeId}`
}

function isReservationScopeType(value: unknown): value is ReservationScopeType {
  return value === 'user' || value === 'organization' || value === 'organization_member'
}

function parseScope(raw: unknown): ReservationScope | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!isReservationScopeType(record.scopeType)) return null
  if (typeof record.scopeId !== 'string' || record.scopeId.length === 0) return null
  return {
    scopeType: record.scopeType,
    scopeId: record.scopeId,
  }
}

function parseReservation(raw: unknown): CopilotUsageReservation | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof record.scopeId !== 'string' ||
    typeof record.reason !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    !isReservationScopeType(record.scopeType)
  ) {
    return null
  }

  const reservedUsd =
    typeof record.reservedUsd === 'number'
      ? record.reservedUsd
      : typeof record.reservedUsd === 'string'
        ? Number.parseFloat(record.reservedUsd)
        : Number.NaN

  if (!Number.isFinite(reservedUsd) || reservedUsd <= 0) {
    return null
  }

  return {
    id: record.id,
    userId: record.userId,
    workflowId: typeof record.workflowId === 'string' ? record.workflowId : null,
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    reservedUsd,
    reason: record.reason,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}

async function readScopeReservations(scope: ReservationScope): Promise<CopilotUsageReservation[]> {
  const raw = await getCachedValue(getScopeCacheKey(scope))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseReservation).filter((entry): entry is CopilotUsageReservation => entry !== null)
  } catch (error) {
    logger.warn('Failed to parse cached copilot usage reservations', {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

async function writeScopeReservations(
  scope: ReservationScope,
  reservations: CopilotUsageReservation[]
): Promise<void> {
  const key = getScopeCacheKey(scope)
  if (reservations.length === 0) {
    await deleteCachedValue(key)
    return
  }

  await setCachedValue(key, JSON.stringify(reservations), RESERVATION_TTL_SECONDS)
}

async function readReservationLookup(reservationId: string): Promise<ReservationScope | null> {
  const raw = await getCachedValue(getReservationLookupKey(reservationId))
  if (!raw) return null

  try {
    return parseScope(JSON.parse(raw))
  } catch (error) {
    logger.warn('Failed to parse copilot reservation lookup', {
      reservationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function writeReservationLookup(
  reservationId: string,
  scope: ReservationScope
): Promise<void> {
  await setCachedValue(
    getReservationLookupKey(reservationId),
    JSON.stringify(scope),
    RESERVATION_TTL_SECONDS
  )
}

function pruneExpiredReservations(
  reservations: CopilotUsageReservation[],
  nowMs = Date.now()
): CopilotUsageReservation[] {
  return reservations.filter((reservation) => {
    const expiry = Date.parse(reservation.expiresAt)
    return Number.isFinite(expiry) && expiry > nowMs
  })
}

function sumReservedUsd(reservations: CopilotUsageReservation[]): number {
  return reservations.reduce((total, reservation) => total + reservation.reservedUsd, 0)
}

async function withScopeLock<T>(scope: ReservationScope, action: () => Promise<T>): Promise<T> {
  const lockKey = getScopeLockKey(scope)
  const token = crypto.randomUUID()
  const acquired = await acquireLock(lockKey, token, LOCK_TTL_SECONDS)

  if (!acquired) {
    throw new Error(`Could not acquire copilot usage reservation lock for ${scope.scopeType}:${scope.scopeId}`)
  }

  try {
    return await action()
  } finally {
    await releaseLock(lockKey, token).catch((error) => {
      logger.warn('Failed to release copilot usage reservation lock', {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

async function resolveReservationScope(params: {
  userId: string
  workflowId?: string | null
}): Promise<ReservationScope> {
  if (!params.workflowId) {
    return {
      scopeType: 'user',
      scopeId: params.userId,
    }
  }

  const billingContext = await resolveWorkflowBillingContext({
    workflowId: params.workflowId,
    actorUserId: params.userId,
  })

  return {
    scopeType: billingContext.scopeType as ReservationScopeType,
    scopeId: billingContext.scopeId,
  }
}

export async function reserveCopilotUsage(params: {
  userId: string
  workflowId?: string | null
  requestedUsd: number
  reason?: string
}): Promise<CopilotUsageReservationResult> {
  const scope = await resolveReservationScope(params)

  return withScopeLock(scope, async () => {
    const reservations = pruneExpiredReservations(await readScopeReservations(scope))
    await writeScopeReservations(scope, reservations)

    const usage = await checkServerSideUsageLimits({
      userId: params.userId,
      workflowId: params.workflowId ?? null,
    })

    const activeReservedUsd = sumReservedUsd(reservations)
    const remainingBeforeReserve = Math.max(0, usage.limit - usage.currentUsage - activeReservedUsd)

    if (usage.isExceeded || remainingBeforeReserve < params.requestedUsd) {
      return {
        allowed: false,
        status: 402,
        currentUsage: usage.currentUsage,
        limit: usage.limit,
        remaining: remainingBeforeReserve,
        activeReservedUsd,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        message: usage.message,
      }
    }

    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + RESERVATION_TTL_SECONDS * 1000)
    const reservation: CopilotUsageReservation = {
      id: crypto.randomUUID(),
      userId: params.userId,
      workflowId: params.workflowId ?? null,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      reservedUsd: params.requestedUsd,
      reason: params.reason ?? 'request',
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    await writeScopeReservations(scope, [...reservations, reservation])
    await writeReservationLookup(reservation.id, scope)

    return {
      allowed: true,
      status: 200,
      reservationId: reservation.id,
      reservedUsd: reservation.reservedUsd,
      currentUsage: usage.currentUsage,
      limit: usage.limit,
      remaining: Math.max(0, remainingBeforeReserve - reservation.reservedUsd),
      activeReservedUsd: activeReservedUsd + reservation.reservedUsd,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      expiresAt: reservation.expiresAt,
      message: usage.message,
    }
  })
}

export async function adjustCopilotUsageReservation(params: {
  reservationId: string
  userId: string
  workflowId?: string | null
  requestedUsd: number
  reason?: string
}): Promise<CopilotUsageReservationResult> {
  const lookup = await readReservationLookup(params.reservationId)
  if (!lookup) {
    return {
      allowed: false,
      status: 404,
      currentUsage: 0,
      limit: 0,
      remaining: 0,
      activeReservedUsd: 0,
      scopeType: 'user',
      scopeId: params.userId,
      message: 'Reservation not found',
    }
  }

  return withScopeLock(lookup, async () => {
    const reservations = pruneExpiredReservations(await readScopeReservations(lookup))
    const reservation = reservations.find((entry) => entry.id === params.reservationId) ?? null

    if (!reservation) {
      await deleteCachedValue(getReservationLookupKey(params.reservationId))
      return {
        allowed: false,
        status: 404,
        currentUsage: 0,
        limit: 0,
        remaining: 0,
        activeReservedUsd: 0,
        scopeType: lookup.scopeType,
        scopeId: lookup.scopeId,
        message: 'Reservation not found',
      }
    }

    const usage = await checkServerSideUsageLimits({
      userId: params.userId,
      workflowId: params.workflowId ?? reservation.workflowId,
    })

    const otherReservations = reservations.filter((entry) => entry.id !== params.reservationId)
    const otherReservedUsd = sumReservedUsd(otherReservations)
    const remainingBeforeAdjust = Math.max(0, usage.limit - usage.currentUsage - otherReservedUsd)

    if (usage.isExceeded || remainingBeforeAdjust < params.requestedUsd) {
      return {
        allowed: false,
        status: 402,
        reservationId: params.reservationId,
        reservedUsd: reservation.reservedUsd,
        currentUsage: usage.currentUsage,
        limit: usage.limit,
        remaining: remainingBeforeAdjust,
        activeReservedUsd: otherReservedUsd + reservation.reservedUsd,
        scopeType: lookup.scopeType,
        scopeId: lookup.scopeId,
        message: usage.message,
      }
    }

    const refreshedReservation: CopilotUsageReservation = {
      ...reservation,
      userId: params.userId,
      workflowId: params.workflowId ?? reservation.workflowId,
      reservedUsd: params.requestedUsd,
      reason: params.reason ?? reservation.reason,
      expiresAt: new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000).toISOString(),
    }

    await writeScopeReservations(lookup, [...otherReservations, refreshedReservation])
    await writeReservationLookup(params.reservationId, lookup)

    return {
      allowed: true,
      status: 200,
      reservationId: params.reservationId,
      reservedUsd: refreshedReservation.reservedUsd,
      currentUsage: usage.currentUsage,
      limit: usage.limit,
      remaining: Math.max(0, remainingBeforeAdjust - refreshedReservation.reservedUsd),
      activeReservedUsd: otherReservedUsd + refreshedReservation.reservedUsd,
      scopeType: lookup.scopeType,
      scopeId: lookup.scopeId,
      expiresAt: refreshedReservation.expiresAt,
      message: usage.message,
    }
  })
}

export async function releaseCopilotUsageReservation(params: {
  reservationId: string
}): Promise<CopilotUsageReleaseResult> {
  const lookup = await readReservationLookup(params.reservationId)
  if (!lookup) {
    return {
      released: false,
      reservationId: params.reservationId,
    }
  }

  return withScopeLock(lookup, async () => {
    const reservations = pruneExpiredReservations(await readScopeReservations(lookup))
    const reservation = reservations.find((entry) => entry.id === params.reservationId) ?? null
    const remainingReservations = reservations.filter((entry) => entry.id !== params.reservationId)

    await writeScopeReservations(lookup, remainingReservations)
    await deleteCachedValue(getReservationLookupKey(params.reservationId))

    return {
      released: reservation !== null,
      reservationId: params.reservationId,
      reservedUsd: reservation?.reservedUsd,
      scopeType: lookup.scopeType,
      scopeId: lookup.scopeId,
    }
  })
}
