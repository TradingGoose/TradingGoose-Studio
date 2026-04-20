'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkspacePage')

export default function WorkspacePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending, error: sessionError } = useSession()

  useEffect(() => {
    const redirectToFirstWorkspace = async () => {
      // Wait for session to load
      if (isPending) {
        return
      }

      // If user is not authenticated (or session failed), redirect to home
      if (sessionError || !session?.user) {
        logger.info('User not authenticated, redirecting to home', {
          hasSessionError: Boolean(sessionError),
        })
        router.replace('/')
        return
      }

      try {
        // Check if we need to redirect a specific workflow from old URL format
        const urlParams = new URLSearchParams(window.location.search)
        const callbackUrl = urlParams.get('callbackUrl')
        const redirectWorkflowId = urlParams.get('redirect_workflow')

        if (
          callbackUrl?.startsWith('/') &&
          !callbackUrl.startsWith('//') &&
          callbackUrl !== window.location.pathname
        ) {
          logger.info('Redirecting to callback URL from workspace root', { callbackUrl })
          router.replace(callbackUrl)
          return
        }

        if (redirectWorkflowId) {
          // Try to get the workspace for this workflow
          try {
            const workflowResponse = await fetch(`/api/workflows/${redirectWorkflowId}`)
            if (workflowResponse.ok) {
              const workflowData = await workflowResponse.json()
              const workspaceId = workflowData.data?.workspaceId

              if (workspaceId) {
                logger.info(
                  `Redirecting workflow ${redirectWorkflowId} to workspace ${workspaceId} dashboard`
                )
                router.replace(`/workspace/${workspaceId}/dashboard`)
                return
              }
            }
          } catch (error) {
            logger.error('Error fetching workflow for redirect:', error)
          }
        }

        // Fetch user's workspaces
        const response = await fetch('/api/workspaces', {
          credentials: 'include',
        })

        if (response.status === 401 || response.status === 403) {
          logger.info('Unauthorized to fetch workspaces, redirecting to home', {
            status: response.status,
          })
          router.replace('/')
          return
        }

        if (!response.ok) {
          let errorBody = ''
          try {
            errorBody = await response.text()
          } catch {}

          logger.error('Failed to fetch workspaces for redirect', {
            status: response.status,
            body: errorBody,
          })
          router.replace('/')
          return
        }

        const data = await response.json()
        const workspaces = data.workspaces || []

        if (workspaces.length === 0) {
          logger.warn('No workspaces found for user, creating default workspace')

          try {
            const createResponse = await fetch('/api/workspaces', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: 'My Workspace' }),
            })

            if (createResponse.ok) {
              const createData = await createResponse.json()
              const newWorkspace = createData.workspace

              if (newWorkspace?.id) {
                logger.info(
                  `Created default workspace ${newWorkspace.id}, redirecting to dashboard`
                )
                router.replace(`/workspace/${newWorkspace.id}/dashboard`)
                return
              }
            }

            logger.error('Failed to create default workspace')
          } catch (createError) {
            logger.error('Error creating default workspace:', createError)
          }

          // If we can't create a workspace, redirect home to reset state
          router.replace('/')
          return
        }

        // Get the first workspace (they should be ordered by most recent)
        const firstWorkspace = workspaces[0]
        logger.info(`Redirecting to workspace ${firstWorkspace.id} dashboard`)

        // Redirect to the first workspace
        router.replace(`/workspace/${firstWorkspace.id}/dashboard`)
      } catch (error) {
        logger.error('Error fetching workspaces for redirect:', error)
        // Any unexpected error should send the user home.
        router.replace('/')
      }
    }

    // Only run this logic when we're at the root /workspace path
    // If we're already in a specific workspace, the children components will handle it
    if (typeof window !== 'undefined') {
      const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
      if (normalizedPath === '/workspace') {
        redirectToFirstWorkspace()
      }
    }
  }, [session, isPending, sessionError, router, searchParams])

  // Show loading state while we determine where to redirect
  if (isPending) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div className='flex flex-col items-center justify-center text-center align-middle'>
          <LoadingAgent size='lg' />
        </div>
      </div>
    )
  }

  // If user is not authenticated, show nothing (redirect will happen)
  if (sessionError || !session?.user) {
    return null
  }

  return null
}
