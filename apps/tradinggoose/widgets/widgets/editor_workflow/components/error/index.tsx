'use client'

import { Component, type ReactNode, useEffect } from 'react'
import { CircleX } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('ErrorBoundary')

// ======== Shared Error UI Component ========
interface ErrorUIProps {
  title?: string
  message?: string
  onReset?: () => void
  fullScreen?: boolean
}

export function ErrorUI({ title, message, onReset, fullScreen = false }: ErrorUIProps) {
  const copy = useWorkflowEditorCopy().error
  const resolvedTitle = title ?? copy.title
  const resolvedMessage = message ?? copy.message
  const containerClass = fullScreen
    ? 'flex flex-col w-full h-screen bg-muted/40'
    : 'flex flex-col w-full h-full bg-muted/40'

  return (
    <div className={containerClass}>
      {/* Main content area */}
      <div className='relative flex flex-1'>
        {/* Error message */}
        <div className='flex flex-1 items-center justify-center'>
          <Card className='max-w-md space-y-4 p-6 text-center'>
            <div className='flex justify-center'>
              <CircleX className='h-16 w-16 text-muted-foreground' />
            </div>
            <h3 className='font-semibold text-lg'>{resolvedTitle}</h3>
            <p className='text-muted-foreground'>{resolvedMessage}</p>
            {onReset ? (
              <div className='flex justify-center'>
                <Button type='button' variant='outline' onClick={onReset}>
                  {copy.tryAgain}
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ======== React Error Boundary Component ========
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorUI />
    }

    return this.props.children
  }
}

// ======== Next.js Error Page Component ========
interface NextErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export function NextError({ error, reset }: NextErrorProps) {
  useEffect(() => {
    // Optionally log the error to an error reporting service
    logger.error('Workflow error:', { error })
  }, [error])
  const copy = useWorkflowEditorCopy().error

  return <ErrorUI title={copy.applicationTitle} message={copy.applicationMessage} onReset={reset} />
}

// ======== Next.js Global Error Page Component ========
export function NextGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error('Global workspace error:', { error })
  }, [error])
  const locale = useLocale()
  const copy = useWorkflowEditorCopy().error

  return (
    <html lang={locale}>
      <body>
        <ErrorUI
          title={copy.applicationTitle}
          message={copy.applicationMessage}
          onReset={reset}
          fullScreen={true}
        />
      </body>
    </html>
  )
}
