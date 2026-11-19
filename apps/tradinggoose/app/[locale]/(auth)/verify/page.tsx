import { hasEmailService } from '@/lib/email/mailer'
import { isEmailVerificationEnabled } from '@/lib/environment'
import { VerifyContent } from '@/app/(auth)/verify/verify-content'

export const dynamic = 'force-dynamic'

export default async function VerifyPage() {
  const emailServiceConfigured = await hasEmailService()

  return (
    <VerifyContent
      hasEmailService={emailServiceConfigured}
      isEmailVerificationEnabled={isEmailVerificationEnabled}
    />
  )
}
