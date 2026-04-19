export const DEFAULT_REGISTRATION_MODE = 'open' as const

export const REGISTRATION_MODE_VALUES = ['open', 'waitlist', 'disabled'] as const
export type RegistrationMode = (typeof REGISTRATION_MODE_VALUES)[number]

export const WAITLIST_STATUS_VALUES = ['pending', 'approved', 'rejected', 'signed_up'] as const
export type WaitlistStatus = (typeof WAITLIST_STATUS_VALUES)[number]

export const REGISTRATION_DISABLED_MESSAGE = 'Registration is currently disabled.'
export const REGISTRATION_WAITLIST_MESSAGE =
  'Registration is limited to approved waitlist emails.'

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

export function getRegistrationPrimaryLabel(mode: RegistrationMode) {
  switch (mode) {
    case 'open':
      return 'Get Started'
    case 'waitlist':
      return 'Join Waitlist'
    case 'disabled':
      return 'Coming soon'
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

export function getAuthRegistrationLabel(mode: RegistrationMode) {
  switch (mode) {
    case 'open':
      return 'Sign up'
    case 'waitlist':
      return 'Join waitlist'
    case 'disabled':
      return null
  }
}
