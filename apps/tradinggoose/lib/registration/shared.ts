export const DEFAULT_REGISTRATION_MODE = 'open' as const

export const REGISTRATION_MODE_VALUES = ['open', 'waitlist', 'disabled'] as const
export type RegistrationMode = (typeof REGISTRATION_MODE_VALUES)[number]

export const WAITLIST_STATUS_VALUES = ['pending', 'approved', 'rejected', 'signed_up'] as const
export type WaitlistStatus = (typeof WAITLIST_STATUS_VALUES)[number]

export const REGISTRATION_DISABLED_REASON = 'registration_disabled' as const
export const REGISTRATION_WAITLIST_REASON = 'registration_waitlist' as const

export function getRegistrationPrimaryHref(mode: RegistrationMode) {
  switch (mode) {
    case 'open':
      return '/signup'
    case 'waitlist':
      return '/waitlist'
    case 'disabled':
      return null
  }
}

export function getAuthRegistrationHref(mode: RegistrationMode) {
  switch (mode) {
    case 'open':
      return '/signup'
    case 'waitlist':
      return '/waitlist'
    case 'disabled':
      return null
  }
}
