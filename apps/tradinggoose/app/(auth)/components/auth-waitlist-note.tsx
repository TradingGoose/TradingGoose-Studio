'use client'
import { useLocale, useMessages } from 'next-intl'
import { inter } from '@/app/fonts/inter'
import type { LocaleCode } from '@/i18n/utils'

export function AuthWaitlistNote() {
  const locale = useLocale() as LocaleCode
  const copy = useMessages()

  return (
    <div
      className={`${inter.className} mx-auto mt-4 w-fit max-w-full rounded-md border bg-muted/30 px-4 py-3 text-center text-sm`}
    >
      {copy.auth.note.waitlistApprovedEmail}
    </div>
  )
}
