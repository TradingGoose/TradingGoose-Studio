import { render } from '@react-email/components'
import { LocalizedEmail } from '@/components/emails/localized-email'
import {
  type EmailLocale,
  emailText,
  formatEmailCurrency,
  formatEmailDate,
  formatEmailDateTime,
  getEmailCopy,
  normalizeEmailTemplateLocale,
} from '@/components/emails/email-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

export type EmailSubjectType =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'reset-password'
  | 'change-email'
  | 'chat-access'
  | 'invitation'
  | 'batch-invitation'
  | 'workspace-invitation'
  | 'help-confirmation'
  | 'enterprise-subscription'
  | 'plan-welcome'
  | 'usage-threshold'
  | 'free-tier-upgrade'
  | 'payment-failed'
  | 'waitlist-confirmation'
  | 'waitlist-approved'
  | 'careers-confirmation'

const otpTypes = ['sign-in', 'email-verification', 'forget-password', 'change-email', 'chat-access'] as const
type OtpType = (typeof otpTypes)[number]

function commonValues(values: Record<string, string | number> = {}) {
  return {
    brandName: getBrandConfig().name,
    chatTitle: values.chatTitle || 'Chat',
    organizationName: values.organizationName || 'team',
    workspaceName: values.workspaceName || 'Workspace',
    planName: values.planName || '',
    position: values.position || '',
    ...values,
  }
}

function text(locale: EmailLocale, template: string, values: Record<string, string | number> = {}) {
  return emailText(template, commonValues(values))
}

export function getEmailSubject(
  type: EmailSubjectType,
  locale?: EmailLocale,
  values: Record<string, string | number> = {}
): string {
  const copy = getEmailCopy(locale)
  const template = copy.subjects[type] ?? copy.subjects['email-verification']
  return text(locale, template, values)
}

export function getPlanWelcomeSubject(planName: string, locale?: EmailLocale): string {
  return getEmailSubject('plan-welcome', locale, { planName })
}

export async function renderOTPEmail(
  otp: string,
  email: string,
  type: OtpType = 'email-verification',
  chatTitle?: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)
  const title = text(locale, copy.otp.titles[type], { chatTitle: chatTitle || 'Chat' })

  return await render(
    LocalizedEmail({
      locale,
      preview: getEmailSubject(type, locale, { chatTitle: chatTitle || 'Chat' }),
      title,
      paragraphs: [copy.otp.body],
      code: otp,
      muted: [copy.shared.expires15, copy.shared.ignore],
      footerLine: text(locale, copy.shared.sentOnTo, {
        date: formatEmailDate(locale, new Date()),
        email,
      }),
    })
  )
}

export async function renderPasswordResetEmail(
  username: string,
  resetLink: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)

  return await render(
    LocalizedEmail({
      locale,
      preview: getEmailSubject('reset-password', locale),
      title: copy.resetPassword.title,
      paragraphs: [text(locale, copy.resetPassword.intro), copy.resetPassword.action],
      cta: { href: resetLink, label: copy.resetPassword.cta },
      muted: [copy.shared.expires24, copy.shared.ignore],
      footerLine: text(locale, copy.resetPassword.sentLine, {
        date: formatEmailDate(locale, new Date()),
        account: username || copy.resetPassword.accountFallback,
      }),
    })
  )
}

export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  invitationUrl: string,
  email: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)

  return await render(
    LocalizedEmail({
      locale,
      preview: text(locale, copy.invitation.preview, { inviterName, organizationName }),
      title: text(locale, copy.invitation.title, { organizationName }),
      paragraphs: [
        text(locale, copy.invitation.intro, { inviterName }),
        text(locale, copy.invitation.body),
      ],
      cta: { href: invitationUrl, label: copy.invitation.cta },
      muted: [copy.shared.ignore, copy.shared.expires48],
      footerLine: text(locale, copy.shared.sentOnTo, {
        date: formatEmailDate(locale, new Date()),
        email,
      }),
    })
  )
}

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export async function renderBatchInvitationEmail(
  inviterName: string,
  organizationName: string,
  organizationRole: 'admin' | 'member',
  workspaceInvitations: WorkspaceInvitation[],
  acceptUrl: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)
  const roleLabel = copy.batchInvitation.roleLabels[organizationRole]
  const workspaceWord =
    workspaceInvitations.length === 1
      ? copy.batchInvitation.workspaceSingular
      : copy.batchInvitation.workspacePlural

  return await render(
    LocalizedEmail({
      locale,
      preview: text(locale, copy.batchInvitation.preview, { organizationName }),
      title: text(locale, copy.batchInvitation.title, { organizationName }),
      paragraphs: [
        text(locale, copy.batchInvitation.intro, {
          inviterName,
          roleLabel,
        }),
        organizationRole === 'admin'
          ? copy.batchInvitation.adminDescription
          : copy.batchInvitation.memberDescription,
      ],
      detailsTitle:
        workspaceInvitations.length > 0
          ? text(locale, copy.batchInvitation.workspaceAccess, {
              count: workspaceInvitations.length,
              workspaceWord,
            })
          : undefined,
      details: workspaceInvitations.map((workspaceInvitation) =>
        text(locale, copy.batchInvitation.workspaceLine, {
          workspaceName: workspaceInvitation.workspaceName,
          permissionLabel: copy.batchInvitation.permissionLabels[workspaceInvitation.permission],
        })
      ),
      cta: { href: acceptUrl, label: copy.batchInvitation.cta },
      muted: [
        text(
          locale,
          workspaceInvitations.length > 0
            ? copy.batchInvitation.closingWithWorkspaces
            : copy.batchInvitation.closing,
          {
            organizationName,
            count: workspaceInvitations.length,
            workspaceWord,
          }
        ),
        copy.shared.expires7,
      ],
      footerLine: text(locale, copy.shared.team, { brandName: getBrandConfig().name }),
    })
  )
}

export async function renderWorkspaceInvitationEmail(params: {
  workspaceName: string
  inviterName: string
  invitationLink: string
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: text(params.locale, copy.workspaceInvitation.preview, {
        workspaceName: params.workspaceName,
      }),
      title: text(params.locale, copy.workspaceInvitation.title, {
        workspaceName: params.workspaceName,
      }),
      paragraphs: [
        text(params.locale, copy.workspaceInvitation.intro, {
          inviterName: params.inviterName,
          workspaceName: params.workspaceName,
        }),
      ],
      cta: { href: params.invitationLink, label: copy.workspaceInvitation.cta },
      muted: [copy.shared.expires7, copy.shared.ignore],
      footerLine: text(params.locale, copy.shared.team, { brandName: getBrandConfig().name }),
    })
  )
}

export async function renderHelpConfirmationEmail(
  userEmail: string,
  type: 'bug' | 'feedback' | 'feature_request' | 'other',
  attachmentCount = 0,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)
  const typeLabel = copy.help.typeLabels[type]
  const emailPart = userEmail ? text(locale, copy.shared.emailPartFrom, { email: userEmail }) : ''
  const paragraphs = [
    text(locale, copy.help.intro, { typeLabel: typeLabel.toLowerCase() }),
    text(locale, copy.help.responseTime, { supportEmail: getBrandConfig().supportEmail }),
  ]

  if (attachmentCount > 0) {
    paragraphs.splice(
      1,
      0,
      text(locale, copy.help.attachments, {
        count: attachmentCount,
        fileWord: attachmentCount === 1 ? copy.help.fileSingular : copy.help.filePlural,
      })
    )
  }

  return await render(
    LocalizedEmail({
      locale,
      preview: text(locale, copy.help.preview, { typeLabel: typeLabel.toLowerCase() }),
      title: copy.help.title,
      paragraphs,
      footerLine: text(locale, copy.shared.sentOnFor, {
        date: formatEmailDate(locale, new Date()),
        typeLabel: typeLabel.toLowerCase(),
        emailPart,
      }),
    })
  )
}

export async function renderEnterpriseSubscriptionEmail(
  userName: string,
  userEmail: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)
  const baseUrl = getBaseUrl()

  return await render(
    LocalizedEmail({
      locale,
      preview: getEmailSubject('enterprise-subscription', locale),
      title: copy.billing.enterprise.title,
      paragraphs: [
        text(locale, copy.billing.enterprise.welcome, { userName }),
        text(locale, copy.billing.enterprise.body),
      ],
      cta: { href: `${baseUrl}/login`, label: copy.billing.enterprise.cta },
      detailsTitle: copy.billing.enterprise.nextStepsTitle,
      details: copy.billing.enterprise.nextSteps,
      muted: [copy.billing.enterprise.help],
      footerLine: text(locale, copy.shared.sentOnTo, {
        date: formatEmailDate(locale, new Date()),
        email: userEmail,
      }),
    })
  )
}

export async function renderUsageThresholdEmail(params: {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink: string
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: text(params.locale, copy.billing.usage.preview, {
        percentUsed: params.percentUsed,
        planName: params.planName,
      }),
      title: text(params.locale, copy.billing.usage.title, { percentUsed: params.percentUsed }),
      paragraphs: [
        text(params.locale, copy.billing.usage.intro, {
          userNamePrefix: params.userName ? `${params.userName}, ` : '',
          planName: params.planName,
        }),
        copy.billing.usage.recommendation,
      ],
      details: [
        text(params.locale, copy.billing.usage.usageLine, {
          currentUsage: formatEmailCurrency(params.locale, params.currentUsage),
          limit: formatEmailCurrency(params.locale, params.limit),
        }),
        text(params.locale, copy.billing.usage.percentLine, { percentUsed: params.percentUsed }),
      ],
      cta: { href: params.ctaLink, label: copy.billing.usage.cta },
      muted: [copy.billing.usage.reason],
      footerLine: text(params.locale, copy.shared.sentOn, {
        date: formatEmailDate(params.locale, new Date()),
      }),
    })
  )
}

export async function renderFreeTierUpgradeEmail(params: {
  userName?: string
  currentTierName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
  recommendedTierName?: string | null
  recommendedTierPriceUsd?: number | null
  recommendedTierIncludedUsageLimitUsd?: number | null
  recommendedTierFeatures?: string[]
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)
  const currentTierName = params.currentTierName || copy.billing.freeTier.currentTierFallback
  const details: string[] = []

  if (params.recommendedTierName) {
    details.push(text(params.locale, copy.billing.freeTier.recommendedTier, {
      tierName: params.recommendedTierName,
    }))
  }
  if (params.recommendedTierPriceUsd) {
    details.push(text(params.locale, copy.billing.freeTier.recommendedPrice, {
      price: formatEmailCurrency(params.locale, params.recommendedTierPriceUsd),
    }))
  }
  if (params.recommendedTierIncludedUsageLimitUsd) {
    details.push(text(params.locale, copy.billing.freeTier.recommendedUsage, {
      usage: formatEmailCurrency(params.locale, params.recommendedTierIncludedUsageLimitUsd),
    }))
  }
  details.push(...(params.recommendedTierFeatures ?? []).slice(0, 3))

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: text(params.locale, copy.billing.freeTier.preview, { currentTierName }),
      title: copy.billing.freeTier.title,
      paragraphs: [
        text(params.locale, copy.billing.freeTier.greeting, {
          userName: params.userName || copy.billing.freeTier.greetingFallback,
        }),
        text(params.locale, copy.billing.freeTier.usage, {
          currentUsage: formatEmailCurrency(params.locale, params.currentUsage),
          limit: formatEmailCurrency(params.locale, params.limit),
          currentTierName,
          percentUsed: params.percentUsed,
        }),
        copy.billing.freeTier.body,
      ],
      detailsTitle: details.length > 0 ? copy.billing.freeTier.recommendedTitle : undefined,
      details,
      cta: { href: params.upgradeLink, label: copy.billing.freeTier.cta },
      muted: [copy.billing.freeTier.oneTime],
      footerLine: text(params.locale, copy.shared.sentOn, {
        date: formatEmailDate(params.locale, new Date()),
      }),
    })
  )
}

export async function renderPaymentFailedEmail(params: {
  userName?: string
  amountDue?: number
  lastFourDigits?: string
  billingPortalUrl: string
  failureReason?: string
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)
  const details = [
    text(params.locale, copy.billing.paymentFailed.amountDue, {
      amount: formatEmailCurrency(params.locale, params.amountDue ?? 0),
    }),
  ]

  if (params.lastFourDigits) {
    details.push(text(params.locale, copy.billing.paymentFailed.paymentMethod, {
      lastFourDigits: params.lastFourDigits,
    }))
  }
  if (params.failureReason) {
    details.push(text(params.locale, copy.billing.paymentFailed.reason, {
      reason: params.failureReason,
    }))
  }

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: getEmailSubject('payment-failed', params.locale),
      title: copy.billing.paymentFailed.title,
      paragraphs: [
        text(params.locale, copy.billing.paymentFailed.greeting, {
          userName: params.userName || copy.billing.paymentFailed.greetingFallback,
        }),
        copy.billing.paymentFailed.body,
      ],
      detailsTitle: copy.billing.paymentFailed.detailsTitle,
      details,
      cta: { href: params.billingPortalUrl, label: copy.billing.paymentFailed.cta },
      muted: [copy.billing.paymentFailed.nextSteps, copy.billing.paymentFailed.help],
      footerLine: text(params.locale, copy.billing.paymentFailed.sentLine, {
        date: formatEmailDate(params.locale, new Date()),
      }),
    })
  )
}

export async function renderWaitlistConfirmationEmail(
  email: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)

  return await render(
    LocalizedEmail({
      locale,
      preview: copy.waitlist.confirmation.preview,
      title: copy.waitlist.confirmation.title,
      paragraphs: [
        text(locale, copy.waitlist.confirmation.intro, { email }),
        copy.waitlist.confirmation.body,
      ],
      muted: [copy.shared.ignore],
      footerLine: text(locale, copy.shared.submittedOnTo, {
        date: formatEmailDate(locale, new Date()),
        email,
      }),
    })
  )
}

export async function renderWaitlistApprovedEmail(
  email: string,
  signupLink: string,
  locale?: EmailLocale
): Promise<string> {
  const copy = getEmailCopy(locale)

  return await render(
    LocalizedEmail({
      locale,
      preview: copy.waitlist.approved.preview,
      title: copy.waitlist.approved.title,
      paragraphs: [
        text(locale, copy.waitlist.approved.intro, { email }),
        copy.waitlist.approved.body,
      ],
      cta: { href: signupLink, label: copy.waitlist.approved.cta },
      muted: [copy.waitlist.approved.methodReminder],
      footerLine: text(locale, copy.shared.approvedOnFor, {
        date: formatEmailDate(locale, new Date()),
        email,
      }),
    })
  )
}

export async function renderPlanWelcomeEmail(params: {
  planName: string
  userName?: string
  loginLink?: string
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)
  const baseUrl = getBaseUrl()

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: text(params.locale, copy.billing.planWelcome.preview, {
        planName: params.planName,
      }),
      title: text(params.locale, copy.billing.planWelcome.title, { planName: params.planName }),
      paragraphs: [
        params.userName
          ? text(params.locale, copy.billing.planWelcome.namedWelcome, { userName: params.userName })
          : copy.billing.planWelcome.welcome,
        text(params.locale, copy.billing.planWelcome.body, { planName: params.planName }),
        copy.billing.planWelcome.help,
        copy.billing.planWelcome.settings,
      ],
      cta: {
        href: params.loginLink || `${baseUrl}/login`,
        label: text(params.locale, copy.shared.openBrand, { brandName: getBrandConfig().name }),
      },
      footerLine: text(params.locale, copy.shared.sentOn, {
        date: formatEmailDate(params.locale, new Date()),
      }),
    })
  )
}

export async function renderCareersConfirmationEmail(params: {
  name: string
  position: string
  locale?: EmailLocale
}): Promise<string> {
  const copy = getEmailCopy(params.locale)
  const baseUrl = getBaseUrl()

  return await render(
    LocalizedEmail({
      locale: params.locale,
      preview: text(params.locale, copy.careers.preview),
      title: copy.careers.title,
      paragraphs: [
        text(params.locale, copy.careers.greeting, { name: params.name }),
        text(params.locale, copy.careers.body, { position: params.position }),
        copy.careers.review,
        text(params.locale, copy.careers.explore, { docsUrl: 'https://docs.tradinggoose.ai', blogUrl: `${baseUrl}/blog` }),
      ],
      footerLine: text(params.locale, copy.careers.sentLine, {
        dateTime: formatEmailDateTime(params.locale, new Date()),
      }),
    })
  )
}

export { normalizeEmailTemplateLocale }
