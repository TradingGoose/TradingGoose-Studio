'use client'

import { useMessages } from 'next-intl'
import type {
  AdminMessages,
  AuthMessages,
  BlogMessages,
  CareersMessages,
  ChatMessages,
  InviteMessages,
  LandingMessages,
  NavMessages,
  NotFoundMessages,
  PublicMessages,
  RegistrationMessages,
  UnsubscribeMessages,
  WorkspaceMessages,
} from './message-types'

export { formatTemplate } from './template'
export type { PublicCopy, PublicMessages } from './message-types'

export function useAppMessages(): PublicMessages {
  return useMessages() as PublicMessages
}

export function useNavMessages(): NavMessages {
  return useAppMessages().nav
}

export function useRegistrationMessages(): RegistrationMessages {
  return useAppMessages().registration
}

export function useAuthMessages(): AuthMessages {
  return useAppMessages().auth
}

export function useBlogMessages(): BlogMessages {
  return useAppMessages().blog
}

export function useLandingMessages(): LandingMessages {
  return useAppMessages().landing
}

export function useCareersMessages(): CareersMessages {
  return useAppMessages().careers
}

export function useAdminMessages(): AdminMessages {
  return useAppMessages().admin
}

export function useChatMessages(): ChatMessages {
  return useAppMessages().chat
}

export function useInviteMessages(): InviteMessages {
  return useAppMessages().invite
}

export function useNotFoundMessages(): NotFoundMessages {
  return useAppMessages().notFound
}

export function useUnsubscribeMessages(): UnsubscribeMessages {
  return useAppMessages().unsubscribe
}

export function useWorkspaceMessages(): WorkspaceMessages {
  return useAppMessages().workspace
}
