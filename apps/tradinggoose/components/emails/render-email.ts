import { render } from '@react-email/components'
import {
  BatchInvitationEmail,
  EnterpriseSubscriptionEmail,
  HelpConfirmationEmail,
  InvitationEmail,
  NewsletterWelcomeEmail,
  OTPVerificationEmail,
  PlanWelcomeEmail,
  ResetPasswordEmail,
  UsageThresholdEmail,
  WaitlistApprovedEmail,
  WaitlistConfirmationEmail,
} from '@/components/emails'
import FreeTierUpgradeEmail from '@/components/emails/billing/free-tier-upgrade-email'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

export async function renderOTPEmail(
  otp: string,
  email: string,
  type:
    | 'sign-in'
    | 'email-verification'
    | 'forget-password'
    | 'change-email' = 'email-verification',
  chatTitle?: string
): Promise<string> {
  return await render(OTPVerificationEmail({ otp, email, type, chatTitle }))
}

export async function renderPasswordResetEmail(
  username: string,
  resetLink: string
): Promise<string> {
  return await render(
    ResetPasswordEmail({ username, resetLink: resetLink, updatedDate: new Date() })
  )
}

export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  invitationUrl: string,
  email: string
): Promise<string> {
  return await render(
    InvitationEmail({
      inviterName,
      organizationName,
      inviteLink: invitationUrl,
      invitedEmail: email,
      updatedDate: new Date(),
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
  acceptUrl: string
): Promise<string> {
  return await render(
    BatchInvitationEmail({
      inviterName,
      organizationName,
      organizationRole,
      workspaceInvitations,
      acceptUrl,
    })
  )
}

export async function renderHelpConfirmationEmail(
  userEmail: string,
  type: 'bug' | 'feedback' | 'feature_request' | 'other',
  attachmentCount = 0
): Promise<string> {
  return await render(
    HelpConfirmationEmail({
      userEmail,
      type,
      attachmentCount,
      submittedDate: new Date(),
    })
  )
}

export async function renderEnterpriseSubscriptionEmail(
  userName: string,
  userEmail: string
): Promise<string> {
  const baseUrl = getBaseUrl()
  const loginLink = `${baseUrl}/login`

  return await render(
    EnterpriseSubscriptionEmail({
      userName,
      userEmail,
      loginLink,
      createdDate: new Date(),
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
}): Promise<string> {
  return await render(
    UsageThresholdEmail({
      userName: params.userName,
      planName: params.planName,
      percentUsed: params.percentUsed,
      currentUsage: params.currentUsage,
      limit: params.limit,
      ctaLink: params.ctaLink,
      updatedDate: new Date(),
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
}): Promise<string> {
  return await render(
    FreeTierUpgradeEmail({
      userName: params.userName,
      currentTierName: params.currentTierName,
      percentUsed: params.percentUsed,
      currentUsage: params.currentUsage,
      limit: params.limit,
      upgradeLink: params.upgradeLink,
      recommendedTierName: params.recommendedTierName,
      recommendedTierPriceUsd: params.recommendedTierPriceUsd,
      recommendedTierIncludedUsageLimitUsd: params.recommendedTierIncludedUsageLimitUsd,
      recommendedTierFeatures: params.recommendedTierFeatures,
      updatedDate: new Date(),
    })
  )
}

export async function renderNewsletterWelcomeEmail(): Promise<string> {
  return await render(NewsletterWelcomeEmail())
}

export async function renderWaitlistConfirmationEmail(email: string): Promise<string> {
  return await render(
    WaitlistConfirmationEmail({
      email,
      submittedDate: new Date(),
    })
  )
}

export async function renderWaitlistApprovedEmail(
  email: string,
  signupLink: string
): Promise<string> {
  return await render(
    WaitlistApprovedEmail({
      email,
      signupLink,
      approvedDate: new Date(),
    })
  )
}

export function getEmailSubject(
  type:
    | 'sign-in'
    | 'email-verification'
    | 'forget-password'
    | 'reset-password'
    | 'change-email'
    | 'invitation'
    | 'batch-invitation'
    | 'help-confirmation'
    | 'enterprise-subscription'
    | 'usage-threshold'
    | 'free-tier-upgrade'
    | 'waitlist-confirmation'
    | 'waitlist-approved'
): string {
  const brandName = getBrandConfig().name

  switch (type) {
    case 'sign-in':
      return `Sign in to ${brandName}`
    case 'email-verification':
      return `Verify your email for ${brandName}`
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'reset-password':
      return `Reset your ${brandName} password`
    case 'change-email':
      return `Verify your new email for ${brandName}`
    case 'invitation':
      return `You've been invited to join a team on ${brandName}`
    case 'batch-invitation':
      return `You've been invited to join a team and workspaces on ${brandName}`
    case 'help-confirmation':
      return 'Your request has been received'
    case 'enterprise-subscription':
      return `Your organization billing is now active on ${brandName}`
    case 'usage-threshold':
      return `You're nearing your monthly budget on ${brandName}`
    case 'free-tier-upgrade':
      return `Your current tier is nearing its included usage on ${brandName}`
    case 'waitlist-confirmation':
      return `We received your ${brandName} access request`
    case 'waitlist-approved':
      return `Your ${brandName} access request was approved`
    default:
      return brandName
  }
}

export function getPlanWelcomeSubject(planName: string): string {
  return `Your ${planName} tier is now active on ${getBrandConfig().name}`
}

export async function renderPlanWelcomeEmail(params: {
  planName: string
  userName?: string
  loginLink?: string
}): Promise<string> {
  return await render(
    PlanWelcomeEmail({
      planName: params.planName,
      userName: params.userName,
      loginLink: params.loginLink,
      createdDate: new Date(),
    })
  )
}
