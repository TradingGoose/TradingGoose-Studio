export type InviteErrorCode =
  | 'missing-token'
  | 'invalid-token'
  | 'expired'
  | 'already-processed'
  | 'email-mismatch'
  | 'workspace-not-found'
  | 'user-not-found'
  | 'already-member'
  | 'already-in-organization'
  | 'invalid-invitation'
  | 'missing-invitation-id'
  | 'server-error'
  | 'unknown'

export function getInviteErrorCode(reason: string): InviteErrorCode {
  switch (reason) {
    case 'missing-token':
    case 'invalid-token':
    case 'expired':
    case 'already-processed':
    case 'email-mismatch':
    case 'workspace-not-found':
    case 'user-not-found':
    case 'already-member':
    case 'already-in-organization':
    case 'invalid-invitation':
    case 'missing-invitation-id':
    case 'server-error':
      return reason
    default:
      return 'unknown'
  }
}
