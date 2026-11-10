import { randomUUID } from 'node:crypto'
import {
  advanceFinancialDispatch,
  createFinancialNotification,
  type DispatchClaim,
  dispatchBackoff,
  FinancialPolicyError,
  type FinancialTransaction,
  financialFingerprint,
  financialNamespace,
  financialUsageNotificationFacts,
  lockFinancialRoots,
  type NotificationReceipt,
  prepareFinancialContact,
  readFinancialReceipt,
} from '@tradinggoose/billing'
import { centsToUsd } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { member, settings, user } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  getEmailSubject,
  renderFreeTierUpgradeEmail,
  renderPaymentFailedEmail,
  renderUsageThresholdEmail,
} from '@/components/emails/render-email'
import {
  getPrimaryPublicUserUpgradeTier,
  getTierBasePrice,
  getTierUsageAllowanceUsd,
} from '@/lib/billing/tiers'
import {
  parseFrozenFinancialEmail,
  prepareFinancialEmail,
  sendFinancialEmail,
} from '@/lib/email/financial-email'
import { resolveEmailLocale } from '@/lib/email/locale'
import { getBaseUrl } from '@/lib/urls/utils'

async function recipients(
  tx: FinancialTransaction,
  claim: DispatchClaim,
  memberUserId?: string | null,
  ownerOnly = false
): Promise<string[]> {
  if (claim.root.type === 'user') return [claim.root.id]
  if (memberUserId) return [memberUserId]
  const rows = await tx
    .select({ id: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, claim.root.id),
        inArray(member.role, ownerOnly ? ['owner'] : ['owner', 'admin'])
      )
    )
  return [...new Set(rows.map((row) => row.id))].sort()
}

async function fanout(claim: DispatchClaim) {
  return db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [claim.root])
    if (claim.marker.phase === 'usage-evaluate') {
      const facts = await financialUsageNotificationFacts(
        tx,
        claim.candidate.namespace,
        claim.candidate.key
      )
      if (facts?.warning)
        for (const id of await recipients(tx, claim, facts.memberUserId))
          await createFinancialNotification(tx, {
            ...claim.candidate,
            sourceKey: claim.candidate.key,
            recipientUserId: id,
            notificationKind: 'usage-warning',
          })
      if (facts?.upgrade)
        for (const id of await recipients(tx, claim, facts.memberUserId))
          await createFinancialNotification(tx, {
            ...claim.candidate,
            sourceKey: claim.candidate.key,
            recipientUserId: id,
            notificationKind: 'free-tier-upgrade',
          })
      await advanceFinancialDispatch(
        tx,
        claim,
        (_receipt, marker) => {
          marker.state = facts && (facts.warning || facts.upgrade) ? 'complete' : 'suppressed'
        },
        Date.now()
      )
    } else {
      const source = await readFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key)
      if (!source || source.recordType !== 'invoice')
        throw new FinancialPolicyError('Payment notification has no original invoice intent')
      if (source.invoiceObligationState === 'open')
        for (const id of await recipients(tx, claim, null, true))
          await createFinancialNotification(tx, {
            ...claim.candidate,
            sourceKey: claim.candidate.key,
            recipientUserId: id,
            notificationKind: 'payment-failed',
          })
      await advanceFinancialDispatch(
        tx,
        claim,
        (_receipt, marker) => {
          marker.state = source.invoiceObligationState === 'open' ? 'complete' : 'suppressed'
        },
        Date.now()
      )
    }
  })
}

async function readDeliveryEligibility(
  tx: FinancialTransaction,
  claim: DispatchClaim,
  notification: NotificationReceipt
) {
  await lockFinancialRoots(tx, [claim.root])
  if (
    financialNamespace(notification.root) !== claim.candidate.namespace ||
    financialFingerprint(notification.root) !== financialFingerprint(claim.root) ||
    notification.fingerprint !==
      financialFingerprint({
        source: notification.sourceKey,
        recipient: notification.recipientUserId,
        kind: notification.notificationKind,
      }) ||
    !['payment-failed', 'usage-warning', 'free-tier-upgrade'].includes(
      notification.notificationKind
    ) ||
    (claim.root.type === 'user' && notification.recipientUserId !== claim.root.id)
  )
    throw new FinancialPolicyError('Original financial notification binding is conflicting')
  const [recipient] = await tx
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      enabled: settings.billingUsageNotificationsEnabled,
      preferences: settings.emailPreferences,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(eq(user.id, notification.recipientUserId))
    .limit(1)
  if (!recipient)
    throw new FinancialPolicyError('Original financial notification recipient is unavailable')
  const source = await readFinancialReceipt(tx, claim.candidate.namespace, notification.sourceKey)
  if (!source)
    throw new FinancialPolicyError('Original financial notification source is unavailable')
  if (
    (notification.notificationKind === 'payment-failed'
      ? source.recordType !== 'invoice'
      : source.recordType !== 'operation' || source.contactState !== 'accepted') ||
    !('root' in source || 'identity' in source) ||
    financialNamespace('identity' in source ? source.identity.root : source.root) !==
      claim.candidate.namespace ||
    financialFingerprint(
      source.recordType === 'operation'
        ? source.identity.period
        : 'period' in source
          ? source.period
          : null
    ) !== financialFingerprint(notification.period)
  )
    throw new FinancialPolicyError('Original financial notification source binding is conflicting')
  const preferences = recipient.preferences as {
    unsubscribeAll?: boolean
    unsubscribeNotifications?: boolean
  } | null
  if (
    notification.notificationKind !== 'payment-failed' &&
    (recipient.enabled === false ||
      preferences?.unsubscribeAll ||
      preferences?.unsubscribeNotifications)
  )
    return null
  if (claim.root.type === 'organization') {
    const [access] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, claim.root.id), eq(member.userId, recipient.id)))
      .limit(1)
    if (
      !access ||
      (source.recordType === 'invoice'
        ? access.role !== 'owner'
        : source.recordType === 'operation' && source.identity.memberUserId
          ? source.identity.memberUserId !== recipient.id
          : !['owner', 'admin'].includes(access.role))
    )
      return null
  }
  if (notification.notificationKind === 'payment-failed') {
    if (source.recordType !== 'invoice')
      throw new FinancialPolicyError('Payment notification original source is invalid')
    if (source.invoiceObligationState === 'closed') return null
    return { recipient, source, usage: null }
  }
  const usage = await financialUsageNotificationFacts(
    tx,
    claim.candidate.namespace,
    notification.sourceKey
  )
  if (
    !usage ||
    (notification.notificationKind === 'usage-warning' ? !usage.warning : !usage.upgrade)
  )
    return null
  return { recipient, source, usage }
}

async function prepareDelivery(claim: DispatchClaim) {
  if (claim.receipt.recordType !== 'notification')
    throw new FinancialPolicyError('Notification delivery has no owning financial receipt')
  const notification = claim.receipt
  const data = await db.transaction((tx) => readDeliveryEligibility(tx, claim, notification))
  if (!data)
    return {
      status: 'suppressed' as const,
      reason: 'Current financial notification policy suppresses this unsent event',
    }
  const locale = await resolveEmailLocale({
    userId: data.recipient.id,
    email: data.recipient.email,
  })
  let html: string
  let subject: string
  let emailType: 'transactional' | 'notifications'
  if (notification.notificationKind === 'payment-failed') {
    if (data.source.recordType !== 'invoice')
      throw new FinancialPolicyError('Original invoice receipt required')
    html = await renderPaymentFailedEmail({
      userName: data.recipient.name || undefined,
      amountDue: centsToUsd(data.source.amountCents),
      paymentUrl: `${getBaseUrl()}/workspace?billing=usage`,
      locale,
    })
    subject = getEmailSubject('payment-failed', locale)
    emailType = 'transactional'
  } else if (notification.notificationKind === 'usage-warning') {
    const usage = data.usage!
    html = await renderUsageThresholdEmail({
      userName: data.recipient.name || undefined,
      planName: usage.planName,
      percentUsed: Math.min(100, Math.round(usage.afterPercent)),
      currentUsage: usage.afterUsd,
      limit: usage.limitUsd,
      ctaLink: `${getBaseUrl()}/workspace?billing=usage`,
      locale,
    })
    subject = getEmailSubject('usage-threshold', locale)
    emailType = 'notifications'
  } else {
    const usage = data.usage!
    const tier = await getPrimaryPublicUserUpgradeTier()
    html = await renderFreeTierUpgradeEmail({
      userName: data.recipient.name || undefined,
      currentTierName: usage.planName,
      percentUsed: Math.min(100, Math.round(usage.afterPercent)),
      currentUsage: usage.afterUsd,
      limit: usage.limitUsd,
      upgradeLink: `${getBaseUrl()}/workspace?billing=upgrade`,
      recommendedTierName: tier?.displayName ?? null,
      recommendedTierPriceUsd: tier ? getTierBasePrice(tier) : null,
      recommendedTierIncludedUsageLimitUsd: tier ? getTierUsageAllowanceUsd(tier) : null,
      recommendedTierFeatures: tier?.pricingFeatures ?? [],
      locale,
    })
    subject = getEmailSubject('free-tier-upgrade', locale)
    emailType = 'notifications'
  }
  return prepareFinancialEmail({ to: data.recipient.email, subject, html, emailType, locale })
}

export async function executeFinancialNotification(claim: DispatchClaim, deadlineAt: number) {
  if (claim.marker.phase === 'usage-evaluate' || claim.marker.phase === 'invoice-failure-fanout') {
    await fanout(claim)
    return { outcome: 'complete' as const }
  }
  if (claim.receipt.recordType !== 'notification')
    throw new FinancialPolicyError('Unknown financial notification head')
  const notification = claim.receipt
  let envelope
  if (claim.marker.payload?.envelope)
    envelope = parseFrozenFinancialEmail(claim.marker.payload.envelope)
  else {
    const prepared = await prepareDelivery(claim)
    if (prepared.status === 'suppressed') {
      const suppressed = await db.transaction((tx) =>
        advanceFinancialDispatch(
          tx,
          claim,
          (_receipt, marker) => {
            marker.state = 'suppressed'
          },
          Date.now()
        )
      )
      if (!suppressed) throw new FinancialPolicyError('Financial notification claim was lost')
      return { outcome: 'complete' as const }
    }
    if (prepared.status !== 'ready')
      throw new FinancialPolicyError('Financial mail provider is unavailable')
    envelope = prepared.envelope
  }
  const requestKey = `financial-email:${claim.receipt.fingerprint}`
  const azureOperationId =
    typeof claim.marker.payload?.azureOperationId === 'string'
      ? claim.marker.payload.azureOperationId
      : randomUUID()
  const mayContact = await db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [claim.root])
    const current = await readFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key)
    if (
      !current ||
      current.recordType !== 'notification' ||
      current.fingerprint !== notification.fingerprint ||
      financialFingerprint({
        root: current.root,
        source: current.sourceKey,
        recipient: current.recipientUserId,
        kind: current.notificationKind,
        period: current.period,
      }) !==
        financialFingerprint({
          root: notification.root,
          source: notification.sourceKey,
          recipient: notification.recipientUserId,
          kind: notification.notificationKind,
          period: notification.period,
        })
    )
      throw new FinancialPolicyError('Original financial notification changed before contact')
    const marker = current.markers.find((value) => value.id === claim.marker.id)
    if (!marker || marker.state !== 'claimed' || marker.claimId !== claim.marker.claimId)
      throw new FinancialPolicyError('Financial notification claim was lost')
    const evidence = [
      'firstContactAtMs',
      'requestKey',
      'requestFingerprint',
      'provider',
      'providerId',
      'payload',
    ].some(
      (field) => Object.hasOwn(marker, field) && marker[field as keyof typeof marker] !== undefined
    )
    if (evidence) {
      if (
        !Number.isSafeInteger(marker.firstContactAtMs) ||
        marker.firstContactAtMs! < 0 ||
        marker.firstContactAtMs! > Date.now() ||
        marker.requestKey !== requestKey ||
        marker.requestFingerprint !== envelope.fingerprint ||
        marker.provider !== envelope.provider ||
        !marker.payload?.envelope ||
        parseFrozenFinancialEmail(marker.payload.envelope).fingerprint !== envelope.fingerprint
      )
        throw new FinancialPolicyError(
          'Original financial notification contact requires classification'
        )
    } else {
      if (claim.reconcile)
        throw new FinancialPolicyError(
          'Uncertain financial notification requires original preparation'
        )
      const eligible = await readDeliveryEligibility(tx, claim, current)
      if (!eligible || eligible.recipient.email !== envelope.recipient) {
        const suppressed = await advanceFinancialDispatch(
          tx,
          claim,
          (_receipt, head) => {
            head.state = 'suppressed'
          },
          Date.now()
        )
        if (!suppressed) throw new FinancialPolicyError('Financial notification claim was lost')
        return false
      }
    }
    await prepareFinancialContact(tx, claim, {
      provider: envelope.provider,
      requestKey,
      fingerprint: envelope.fingerprint,
      now: Date.now(),
      payload: { envelope, azureOperationId },
    })
    return true
  })
  if (!mayContact) return { outcome: 'complete' as const }
  const result = await sendFinancialEmail(envelope, {
    requestKey,
    firstContactAtMs: claim.marker.firstContactAtMs!,
    deadlineAt,
    reconcile: claim.reconcile,
    ...(claim.marker.providerId ? { providerId: claim.marker.providerId } : {}),
    azureOperationId,
    ...(typeof claim.marker.payload?.azureResumeFrom === 'string'
      ? { azureResumeFrom: claim.marker.payload.azureResumeFrom }
      : {}),
  })
  await db.transaction((tx) =>
    advanceFinancialDispatch(
      tx,
      claim,
      (_receipt, marker) => {
        if (result.status === 'accepted') {
          marker.state = 'complete'
          marker.providerId = result.providerId
        } else {
          marker.state =
            result.status === 'uncertain' || (claim.reconcile && result.status === 'not-contacted')
              ? 'uncertain'
              : 'pending'
          if (result.status !== 'progress') marker.failedAttempts += 1
          marker.nextAtMs =
            result.status === 'progress'
              ? Date.now()
              : Math.max(
                  dispatchBackoff({ id: marker.id, attempts: marker.failedAttempts }, Date.now()),
                  Date.now() + (result.retryAfterMs ?? 0)
                )
          if (result.status === 'uncertain' || result.status === 'progress') {
            if (result.providerId) marker.providerId = result.providerId
            if (result.azureResumeFrom)
              marker.payload = { ...marker.payload, azureResumeFrom: result.azureResumeFrom }
          }
          if (result.status !== 'progress') marker.failure = result.reason
        }
      },
      Date.now()
    )
  )
  return {
    outcome:
      result.status === 'accepted'
        ? ('complete' as const)
        : result.status === 'progress'
          ? ('progress' as const)
          : result.status === 'uncertain' || (claim.reconcile && result.status === 'not-contacted')
            ? ('uncertain' as const)
            : ('retry' as const),
  }
}
