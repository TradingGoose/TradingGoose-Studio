'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getInviteErrorCode, type InviteErrorCode } from '@/app/invite/[id]/utils'
import { InviteLayout, InviteStatusCard } from '@/app/invite/components'
import { formatTemplate, useAppMessages } from '@/i18n/client-messages'
import { localizeHref, type LocaleCode } from '@/i18n/utils'

const logger = createLogger('InviteById')

export default function Invite() {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const params = useParams()
  const inviteId = params.id as string
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const copy = useAppMessages()
  const inviteCopy = copy.invite
  const inviteErrors = inviteCopy.errors as Record<InviteErrorCode, string>
  const [invitationDetails, setInvitationDetails] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<InviteErrorCode | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [isNewUser, setIsNewUser] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [invitationType, setInvitationType] = useState<'organization' | 'workspace'>('workspace')
  const [currentOrgName, setCurrentOrgName] = useState<string | null>(null)
  const fallbackInvitationName =
    invitationType === 'organization'
      ? inviteCopy.defaultOrganizationName
      : inviteCopy.defaultWorkspaceName

  useEffect(() => {
    const errorReason = searchParams.get('error')

    if (errorReason) {
      setError(getInviteErrorCode(errorReason))
      setIsLoading(false)
      return
    }

    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)

    const tokenFromQuery = searchParams.get('token')
    const effectiveToken = tokenFromQuery || inviteId

    if (effectiveToken) {
      setToken(effectiveToken)
      sessionStorage.setItem('inviteToken', effectiveToken)
    }
  }, [searchParams, inviteId])

  useEffect(() => {
    if (!session?.user || !token) return

    async function fetchInvitationDetails() {
      setIsLoading(true)
      try {
        // Fetch invitation details using the invitation ID from the URL path
        const workspaceInviteResponse = await fetch(`/api/workspaces/invitations/${inviteId}`, {
          method: 'GET',
        })

        if (workspaceInviteResponse.ok) {
          const data = await workspaceInviteResponse.json()
          setInvitationType('workspace')
          setInvitationDetails({
            type: 'workspace',
            data,
            name: data.workspaceName || inviteCopy.defaultWorkspaceName,
          })
          setIsLoading(false)
          return
        }

        try {
          const { data } = await client.organization.getInvitation({
            query: { id: inviteId },
          })

          if (data) {
            setInvitationType('organization')

            // Check if user is already in an organization BEFORE showing the invitation
            const activeOrgResponse = await client.organization
              .getFullOrganization()
              .catch(() => ({ data: null }))

            if (activeOrgResponse?.data) {
              // User is already in an organization
              setCurrentOrgName(activeOrgResponse.data.name)
              setError('already-in-organization')
              setIsLoading(false)
              return
            }

            setInvitationDetails({
              type: 'organization',
              data,
              name: data.organizationName || inviteCopy.defaultOrganizationName,
            })

            if (data.organizationId) {
              const orgResponse = await client.organization.getFullOrganization({
                query: { organizationId: data.organizationId },
              })

              if (orgResponse.data) {
                setInvitationDetails((prev: any) => ({
                  ...prev,
                  name: orgResponse.data.name || inviteCopy.defaultOrganizationName,
                }))
              }
            }
          } else {
            throw new Error('invalid-invitation')
          }
        } catch (_err) {
          throw new Error('invalid-invitation')
        }
      } catch (err: any) {
        logger.error('Error fetching invitation:', err)
        setError(getInviteErrorCode(err.message || 'server-error'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitationDetails()
  }, [session?.user, inviteId, token])

  const handleAcceptInvitation = async () => {
    if (!session?.user) return

    setIsAccepting(true)

    if (invitationType === 'workspace') {
      window.location.href = `/api/workspaces/invitations/${encodeURIComponent(inviteId)}?token=${encodeURIComponent(token || '')}`
    } else {
      try {
        // Get the organizationId from invitation details
        const orgId = invitationDetails?.data?.organizationId

        if (!orgId) {
          throw new Error('missing-invitation-id')
        }

        // Use our custom API endpoint that handles Pro usage snapshot
        const response = await fetch(`/api/organizations/${orgId}/invitations/${inviteId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ status: 'accepted' }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'server-error' }))
          throw new Error(getInviteErrorCode(data.error || 'server-error'))
        }

        // Set the organization as active
        await client.organization.setActive({
          organizationId: orgId,
        })

        setAccepted(true)

        setTimeout(() => {
          router.push(localizeHref(locale, '/workspace'))
        }, 2000)
      } catch (err: any) {
        logger.error('Error accepting invitation:', err)

        // Reset accepted state on error
        setAccepted(false)

        // Check if it's a 409 conflict (already in an organization)
        if (err.status === 409) {
          setError('already-in-organization')
        } else {
          setError(getInviteErrorCode(err.message || 'server-error'))
        }

        setIsAccepting(false)
      }
    }
  }

  const getCallbackUrl = () => {
    return `/invite/${inviteId}${token && token !== inviteId ? `?token=${token}` : ''}`
  }

  if (!session?.user && !isPending) {
    const callbackUrl = encodeURIComponent(getCallbackUrl())

    return (
      <InviteLayout>
        <InviteStatusCard
          type='login'
          title={inviteCopy.login.title}
          description={
            isNewUser
              ? inviteCopy.login.newUserDescription
              : inviteCopy.login.existingUserDescription
          }
          icon='userPlus'
          actions={[
            ...(isNewUser
              ? [
                  {
                    label: inviteCopy.login.createAccount,
                    onClick: () =>
                      router.push(
                        localizeHref(locale, `/signup?callbackUrl=${callbackUrl}&invite_flow=true`)
                      ),
                  },
                  {
                    label: inviteCopy.login.iAlreadyHaveAccount,
                    onClick: () =>
                      router.push(
                        localizeHref(locale, `/login?callbackUrl=${callbackUrl}&invite_flow=true`)
                      ),
                    variant: 'outline' as const,
                  },
                ]
              : [
                  {
                    label: inviteCopy.login.signIn,
                    onClick: () =>
                      router.push(
                        localizeHref(locale, `/login?callbackUrl=${callbackUrl}&invite_flow=true`)
                      ),
                  },
                  {
                    label: inviteCopy.login.createAccount,
                    onClick: () =>
                      router.push(
                        localizeHref(
                          locale,
                          `/signup?callbackUrl=${callbackUrl}&invite_flow=true&new=true`
                        )
                      ),
                    variant: 'outline' as const,
                  },
                ]),
            {
              label: copy.auth.common.returnHome,
              onClick: () => router.push(localizeHref(locale, '/')),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  if (isLoading || isPending) {
    return (
      <InviteLayout>
        <InviteStatusCard
          type='loading'
          title={inviteCopy.loadingTitle}
          description={inviteCopy.loadingDescription}
        />
      </InviteLayout>
    )
  }

  if (error) {
    const errorReason = searchParams.get('error')
    const isExpiredError = errorReason === 'expired'
    const isAlreadyInOrg = error === 'already-in-organization'

    // Special handling for already in organization
    if (isAlreadyInOrg) {
      return (
        <InviteLayout>
          <InviteStatusCard
            type='warning'
            title={inviteCopy.warning.title}
            description={
              currentOrgName
                ? formatTemplate(inviteCopy.warning.currentOrgWithName, {
                    name: currentOrgName,
                  })
                : inviteCopy.warning.currentOrg
            }
            icon='users'
            actions={[
              {
                label: inviteCopy.warning.manageTeamSettings,
                onClick: () => router.push(localizeHref(locale, '/workspace')),
                variant: 'default' as const,
              },
              {
                label: copy.auth.common.returnHome,
                onClick: () => router.push(localizeHref(locale, '/')),
                variant: 'ghost' as const,
              },
            ]}
          />
        </InviteLayout>
      )
    }

    const errorMessage = inviteErrors[error] ?? inviteErrors.unknown

    return (
      <InviteLayout>
        <InviteStatusCard
          type='error'
          title={inviteCopy.error.title}
          description={errorMessage}
          icon='error'
          isExpiredError={isExpiredError}
          actions={[
            {
              label: copy.auth.common.returnHome,
              onClick: () => router.push(localizeHref(locale, '/')),
              variant: 'default' as const,
            },
          ]}
        />
      </InviteLayout>
    )
  }

  // Show success only if accepted AND no error
  if (accepted && !error) {
    const invitationName = invitationDetails?.name || fallbackInvitationName
    return (
      <InviteLayout>
        <InviteStatusCard
          type='success'
          title={inviteCopy.success.title}
          description={formatTemplate(inviteCopy.success.description, { name: invitationName })}
          icon='success'
          actions={[
            {
              label: copy.auth.common.returnHome,
              onClick: () => router.push(localizeHref(locale, '/')),
            },
          ]}
        />
      </InviteLayout>
    )
  }

  return (
    <InviteLayout>
      <InviteStatusCard
        type='invitation'
        title={
          invitationType === 'organization'
            ? inviteCopy.invitation.organizationTitle
            : inviteCopy.invitation.workspaceTitle
        }
        description={formatTemplate(inviteCopy.invitation.description, {
          name: invitationDetails?.name || fallbackInvitationName,
        })}
        icon={invitationType === 'organization' ? 'users' : 'mail'}
        actions={[
          {
            label: inviteCopy.invitation.accept,
            onClick: handleAcceptInvitation,
            disabled: isAccepting,
            loading: isAccepting,
          },
          {
            label: copy.auth.common.returnHome,
            onClick: () => router.push(localizeHref(locale, '/')),
            variant: 'ghost',
          },
        ]}
      />
    </InviteLayout>
  )
}
