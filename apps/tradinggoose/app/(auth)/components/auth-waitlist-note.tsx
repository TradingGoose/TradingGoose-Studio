import { inter } from '@/app/fonts/inter'

export function AuthWaitlistNote() {
  return (
    <div
      className={`${inter.className} mx-auto mt-4 w-fit max-w-full rounded-md border bg-muted/30 px-4 py-3 text-center text-sm`}
    >
      Use the same waitlist-approved email for any sign-in method.
    </div>
  )
}
