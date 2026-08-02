'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('WorkspaceError')

export default function WorkspaceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const copy = useWorkflowEditorCopy().error

  useEffect(() => {
    logger.error('Workspace error:', { error })
  }, [error])

  return (
    <main role='alert' className='flex h-full min-h-96 items-center justify-center bg-muted/40 p-6'>
      <Card className='max-w-md space-y-4 p-6 text-center'>
        <h2 className='font-semibold text-lg'>{copy.applicationTitle}</h2>
        <p className='text-muted-foreground'>{copy.applicationMessage}</p>
        <Button type='button' variant='outline' onClick={unstable_retry}>
          {copy.tryAgain}
        </Button>
      </Card>
    </main>
  )
}
