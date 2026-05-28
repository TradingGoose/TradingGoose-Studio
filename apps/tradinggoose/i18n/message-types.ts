import type { PublicCopy as ServerPublicCopy } from './public-copy'

export type PublicCopy = ServerPublicCopy
export type PublicMessages = PublicCopy
export type NavMessages = PublicMessages['nav']
export type RegistrationMessages = PublicMessages['registration']
export type AuthMessages = PublicMessages['auth']
export type BlogMessages = PublicMessages['blog']
export type LandingMessages = PublicMessages['landing']
export type CareersMessages = PublicMessages['careers']
export type AdminMessages = PublicMessages['admin']
export type ChatMessages = PublicMessages['chat']
export type InviteMessages = PublicMessages['invite']
export type NotFoundMessages = PublicMessages['notFound']
export type UnsubscribeMessages = PublicMessages['unsubscribe']
export type WorkspaceMessages = PublicMessages['workspace']
export type WorkspaceWidgetsMessages = WorkspaceMessages['widgets']
