'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { validateWorkflowPauseInput } from '@/lib/workflows/human-in-the-loop/form'
import type {
  WorkflowCheckpointView,
  WorkflowPausePoint,
} from '@/lib/workflows/human-in-the-loop/types'
import { Link } from '@/i18n/navigation'

type Review = WorkflowCheckpointView & { canSubmit: boolean }

async function readResponse(response: Response): Promise<Review> {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Unable to load workflow review')
  return body
}

function ReviewForm({
  point,
  disabled,
  submit,
}: {
  point: WorkflowCheckpointView['pausePoints'][number]
  disabled: boolean
  submit: (input: Record<string, unknown>) => Promise<unknown>
}) {
  const [error, setError] = useState('')
  return (
    <form
      className='space-y-4'
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        try {
          const values = new FormData(event.currentTarget)
          const input = Object.fromEntries(
            point.inputFormat
              .filter((field) => values.has(field.name) && values.get(field.name) !== '')
              .map((field) => {
                const value = String(values.get(field.name))
                return [
                  field.name,
                  field.type === 'string'
                    ? value
                    : field.type === 'number'
                      ? Number(value)
                      : JSON.parse(value),
                ]
              })
          )
          await submit(validateWorkflowPauseInput(point.inputFormat, input))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Invalid review input')
        }
      }}
    >
      {point.inputFormat.map((field) => {
        const id = `${point.id}-${field.name}`
        const props = {
          id,
          name: field.name,
          required: field.required,
          disabled,
          defaultValue:
            field.value === undefined
              ? ''
              : typeof field.value === 'string'
                ? field.value
                : JSON.stringify(field.value),
        }
        return (
          <div key={field.name} className='space-y-1'>
            <label htmlFor={id} className='font-medium text-sm'>
              {field.name}
              {field.required ? ' *' : ''}
            </label>
            {field.description && (
              <p className='text-muted-foreground text-sm'>{field.description}</p>
            )}
            {field.type === 'boolean' ? (
              <select {...props} className='h-10 w-full rounded-md border bg-background px-3'>
                <option value=''>Select a value</option>
                <option value='true'>True</option>
                <option value='false'>False</option>
              </select>
            ) : field.type === 'string' || field.type === 'number' ? (
              <Input {...props} type={field.type === 'number' ? 'number' : 'text'} step='any' />
            ) : (
              <Textarea
                {...props}
                placeholder={`Enter ${field.type} as JSON`}
                className='font-mono'
              />
            )}
          </div>
        )
      })}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <Button type='submit' disabled={disabled}>
        Submit review
      </Button>
    </form>
  )
}

export function WorkflowReview({
  workflowId,
  executionId,
}: {
  workflowId: string
  executionId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ['workflow-review', workflowId, executionId]
  const endpoint = `/api/resume/${encodeURIComponent(workflowId)}/${encodeURIComponent(executionId)}`
  const query = useQuery({
    queryKey,
    queryFn: async () => readResponse(await fetch(endpoint, { cache: 'no-store' })),
    retry: false,
    refetchInterval: (current) =>
      current.state.data && ['paused', 'queued', 'running'].includes(current.state.data.status)
        ? 3000
        : false,
  })
  const mutation = useMutation({
    mutationFn: async ({
      pausePointId,
      input,
    }: Pick<WorkflowPausePoint, 'input'> & { pausePointId: string }) =>
      readResponse(
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: query.data?.revision, pausePointId, input }),
        })
      ),
    onSuccess: (review) => queryClient.setQueryData(queryKey, review),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const review = query.data
  return (
    <main className='mx-auto w-full max-w-3xl space-y-6 p-6'>
      <h1 className='font-semibold text-2xl'>Workflow review</h1>
      {query.isPending && <p>Loading review…</p>}
      {query.error && (
        <p role='alert' className='text-destructive'>
          {query.error.message}
        </p>
      )}
      {review && (
        <>
          <p className='text-muted-foreground'>
            Execution {executionId} · {review.status}
          </p>
          {review.status === 'paused' && (
            <p>
              All pending reviews and child workflows must finish before this execution continues.
            </p>
          )}
          {!review.canSubmit && (
            <p>
              You have read-only access. A workspace member with write access must submit this
              review.
            </p>
          )}
          {review.pausePoints.map((point) => (
            <section
              key={`${review.revision}:${point.id}`}
              className='space-y-4 rounded-lg border p-5'
            >
              <h2 className='font-semibold'>{point.blockName}</h2>
              <pre className='overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm'>
                {JSON.stringify(point.displayData, null, 2)}
              </pre>
              {point.input !== undefined ? (
                <>
                  <p>Submitted</p>
                  <pre className='overflow-auto whitespace-pre-wrap text-sm'>
                    {JSON.stringify(point.input, null, 2)}
                  </pre>
                </>
              ) : point.kind === 'child' ? (
                <p>
                  Waiting for child workflow: {point.childWorkflowName || point.childWorkflowId}
                  {point.childWorkflowId && point.childExecutionId && (
                    <>
                      {' · '}
                      <Link
                        className='underline'
                        href={`/resume/${encodeURIComponent(point.childWorkflowId)}/${encodeURIComponent(point.childExecutionId)}`}
                      >
                        Open child review
                      </Link>
                    </>
                  )}
                </p>
              ) : (
                <ReviewForm
                  point={point}
                  disabled={!review.canSubmit || review.status !== 'paused' || mutation.isPending}
                  submit={(input) => mutation.mutateAsync({ pausePointId: point.id, input })}
                />
              )}
            </section>
          ))}
        </>
      )}
    </main>
  )
}
