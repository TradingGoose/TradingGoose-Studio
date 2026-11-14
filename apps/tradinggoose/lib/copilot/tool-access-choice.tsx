'use client'

import { useEffect, useRef, useState } from 'react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotToolCall } from '@/stores/copilot/types'
import { ToolCredentialSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector'

/** A new local choice when native history has no original locator; never a billing scope. */
export function ToolAccessChoice({ toolCall }: { toolCall: CopilotToolCall }) {
  const copy = useMessages().workspace.widgets.copilot.driveChoice
  const { authorizeToolWorkspace, readbackCopilotToolCall, executeCopilotToolCall } =
    useCopilotStore()
  const isOAuth = toolCall.name === 'oauth_request_access'
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([])
  const [workspaceId, setWorkspaceId] = useState(toolCall.provenance?.workspaceId ?? '')
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [credentialId, setCredentialId] = useState('')
  const active = useRef(false)
  const request = useRef(0)
  const originalScope = useRef(
    Boolean(toolCall.provenance?.workspaceId || toolCall.provenance?.contextEntityId)
  )

  useEffect(() => {
    active.current = true
    const generation = ++request.current
    const current = () => active.current && request.current === generation
    const load = async () => {
      setBusy(true)
      try {
        const response = await fetch('/api/workspaces')
        if (!response.ok) throw new Error(copy.unavailable)
        const { workspaces: rows } = await response.json()
        if (!current()) return
        if (
          !Array.isArray(rows) ||
          rows.some(
            (row) =>
              !row || typeof row.id !== 'string' || !row.id.trim() || typeof row.name !== 'string'
          ) ||
          new Set(rows.map((row) => row.id)).size !== rows.length
        )
          throw new Error(copy.unavailable)
        setWorkspaces(rows)
        if (originalScope.current) {
          const selected = await authorizeToolWorkspace(toolCall.id)
          if (!current()) return
          setWorkspaceId(selected)
          setAuthorized(true)
        }
      } catch (failure) {
        if (current()) setError(failure instanceof Error ? failure.message : copy.unavailable)
      } finally {
        if (current()) setBusy(false)
      }
    }
    void load()
    return () => {
      active.current = false
      request.current++
    }
  }, [toolCall.id, authorizeToolWorkspace, copy.unavailable])

  return (
    <fieldset className='space-y-2 rounded-md border border-border p-3' aria-busy={busy}>
      <legend className='px-1 font-medium text-sm'>{isOAuth ? copy.oauthTitle : copy.title}</legend>
      <p className='text-muted-foreground text-xs'>
        {originalScope.current ? copy.original : isOAuth ? copy.oauthNewChoice : copy.newChoice}
      </p>
      <label className='block space-y-1 text-sm'>
        <span>{copy.workspace}</span>
        <select
          aria-label={copy.workspace}
          className='h-10 w-full rounded-md border border-input bg-background px-3 text-foreground disabled:opacity-70'
          value={workspaceId}
          disabled={busy || authorized}
          onChange={async (event) => {
            const selected = event.target.value
            if (!selected || !active.current) return
            const generation = ++request.current
            setBusy(true)
            setError(null)
            try {
              const accepted = await authorizeToolWorkspace(toolCall.id, selected)
              if (!active.current || request.current !== generation) return
              setWorkspaceId(accepted)
              setAuthorized(true)
            } catch (failure) {
              if (active.current && request.current === generation)
                setError(failure instanceof Error ? failure.message : copy.unavailable)
            } finally {
              if (active.current && request.current === generation) setBusy(false)
            }
          }}
        >
          <option value=''>{copy.chooseWorkspace}</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      {authorized && workspaceId && isOAuth ? (
        <Button
          type='button'
          size='sm'
          disabled={busy}
          onClick={async () => {
            if (!active.current) return
            const generation = ++request.current
            setBusy(true)
            setError(null)
            try {
              await executeCopilotToolCall(toolCall.id)
            } catch (failure) {
              if (active.current && request.current === generation)
                setError(failure instanceof Error ? failure.message : copy.unavailable)
            } finally {
              if (active.current && request.current === generation) setBusy(false)
            }
          }}
        >
          {copy.connect}
        </Button>
      ) : authorized && workspaceId ? (
        <div className='space-y-1'>
          <p className='text-sm'>{copy.credential}</p>
          <ToolCredentialSelector
            provider='google-drive'
            workspaceId={workspaceId}
            value={credentialId}
            label={copy.credential}
            disabled={busy}
            beforeSelect={async () => {
              if (!active.current) throw new Error(copy.stale)
              const generation = request.current
              await authorizeToolWorkspace(toolCall.id, workspaceId)
              if (!active.current || generation !== request.current) throw new Error(copy.stale)
            }}
            onChange={async (selected) => {
              if (!active.current) return
              const generation = request.current
              setBusy(true)
              setError(null)
              try {
                await readbackCopilotToolCall(toolCall.id, { credentialId: selected })
                if (!active.current || generation !== request.current) return
                setCredentialId(selected)
              } catch (failure) {
                if (active.current && generation === request.current)
                  setError(failure instanceof Error ? failure.message : copy.unavailable)
              } finally {
                if (active.current && generation === request.current) setBusy(false)
              }
            }}
          />
        </div>
      ) : null}
      {error ? (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
